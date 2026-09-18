/* ==========================================================================
   Middleware — authentication, session tokens & rate limiting
   - rateLimit: in-memory per-ip(+key) bucket limiter, self-pruning
   - signToken / setSessionCookie / clearSessionCookie
   - requireAuth: verify cookie, enforce absolute expiry, re-load the user row
     (so deactivation, role changes and password resets apply immediately),
     slide the cookie
   - requireRole: role gate
   ========================================================================== */
const jwt = require("jsonwebtoken");
const db = require("../../database");
const { JWT_SECRET, COOKIE_SECURE } = require("../config/env");

// --- Simple in-memory rate limiter ----------------------------------------
// opts.key(req)          extra discriminator (e.g. the login email)
// opts.skipSuccessful    only failed responses (status >= 400) count
const rateBuckets = new Map();
function rateLimit({ windowMs, max, key, skipSuccessful = false, message }) {
  return (req, res, next) => {
    const k = `${req.ip}:${req.baseUrl || ""}${req.route ? req.route.path : req.path}:${key ? key(req) : ""}`;
    const now = Date.now();
    let bucket = rateBuckets.get(k);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      rateBuckets.set(k, bucket);
    }
    if (bucket.count >= max) {
      res.setHeader("Retry-After", Math.ceil((bucket.reset - now) / 1000));
      return res.status(429).json({
        error: message || "Too many attempts. Please slow down and try again shortly.",
      });
    }
    bucket.count += 1;
    if (skipSuccessful) {
      res.on("finish", () => {
        if (res.statusCode < 400 && bucket.count > 0) bucket.count -= 1;
      });
    }
    next();
  };
}
const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (now > b.reset) rateBuckets.delete(k);
}, 5 * 60 * 1000);
pruneTimer.unref();

// --- Session durations -----------------------------------------------------
// Normal session ~12h; "Remember me" ~14 days. These bound both the JWT's
// absolute expiry and the cookie maxAge (the cookie slides on each request but
// never past the token's absolute_exp).
const SESSION_MS = {
  normal: 12 * 60 * 60 * 1000,
  remember: 14 * 24 * 60 * 60 * 1000,
};
const sessionMs = (rememberMe) =>
  rememberMe ? SESSION_MS.remember : SESSION_MS.normal;

const COOKIE_BASE = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: "strict",
  path: "/",
};

// --- Auth helpers ----------------------------------------------------------
// The token only carries identity + session bookkeeping. Role, department and
// scope are re-read from the database on every request.
function signToken(user, rememberMe = false) {
  const ms = sessionMs(rememberMe);
  return jwt.sign(
    {
      id: user.id,
      tv: user.token_version || 0,
      remember: !!rememberMe,
      absolute_exp: Math.floor((Date.now() + ms) / 1000),
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: Math.floor(ms / 1000) },
  );
}
function setSessionCookie(res, token, rememberMe = false, remainingMs) {
  res.cookie("token", token, {
    ...COOKIE_BASE,
    maxAge: remainingMs != null ? remainingMs : sessionMs(rememberMe),
  });
}
function clearSessionCookie(res) {
  res.clearCookie("token", COOKIE_BASE);
}

// Public shape of the signed-in user (login + /me).
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    department: u.department,
    brand: u.brand,
    all_brands: u.all_brands,
    can_close_override: u.can_close_override,
    region: u.region || null,
    phone: u.phone || null,
  };
}

const USER_COLS = `id, username, email, role, department, brand, all_brands, all_outlets,
  can_close_override, region, phone, is_active, token_version`;

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token)
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  } catch (_) {
    clearSessionCookie(res);
    return res
      .status(401)
      .json({ error: "Unauthorized. Session expired or invalid." });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!decoded.absolute_exp || nowSeconds > decoded.absolute_exp) {
    clearSessionCookie(res);
    return res
      .status(401)
      .json({ error: "Unauthorized. Session absolute lifetime expired." });
  }
  let user;
  try {
    user = await db.pGet(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [decoded.id]);
  } catch (e) {
    return next(e);
  }
  // Deleted, deactivated, or signed out everywhere (password change / reset).
  if (!user || user.is_active === 0 || (user.token_version || 0) !== (decoded.tv || 0)) {
    clearSessionCookie(res);
    return res
      .status(401)
      .json({ error: "Unauthorized. Please sign in again." });
  }
  // Sliding window, but never beyond the token's absolute expiry.
  const remaining = decoded.absolute_exp * 1000 - Date.now();
  setSessionCookie(res, token, !!decoded.remember, Math.min(remaining, sessionMs(!!decoded.remember)));
  req.user = user;
  next();
}

function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden. Access denied." });
    }
    next();
  };
}

// Invalidate every session a user holds (password change, admin reset, deactivation).
function bumpTokenVersion(userId) {
  return db.pRun(
    "UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?",
    [userId],
  );
}

module.exports = {
  rateLimit,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireRole,
  publicUser,
  bumpTokenVersion,
};
