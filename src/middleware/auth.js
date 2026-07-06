/* ==========================================================================
   Middleware — authentication, session tokens & rate limiting
   Verbatim move of the auth cluster from app.js. Logic is unchanged:
   - rateLimit: in-memory per-ip+path bucket limiter
   - signToken / setSessionCookie: JWT issuance + sliding session cookie
   - requireAuth: verify cookie, enforce absolute expiry, slide the cookie
   - requireRole: role gate
   ========================================================================== */
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");

// --- Simple in-memory rate limiter (auth endpoints) ------------------------
const rateBuckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res
        .status(429)
        .json({
          error: "Too many attempts. Please slow down and try again shortly.",
        });
    }
    next();
  };
}

// --- Auth helpers ----------------------------------------------------------
function signToken(user) {
  const absoluteExp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      department: user.department,
      brand: user.brand,
      all_brands: user.all_brands,
      can_close_override: user.can_close_override,
      absolute_exp: absoluteExp,
    },
    JWT_SECRET,
  );
}
function setSessionCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 60 * 1000,
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token)
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.clearCookie("token");
      return res
        .status(401)
        .json({ error: "Unauthorized. Session expired or invalid." });
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (decoded.absolute_exp && nowSeconds > decoded.absolute_exp) {
      res.clearCookie("token");
      return res
        .status(401)
        .json({ error: "Unauthorized. Session absolute lifetime expired." });
    }
    setSessionCookie(res, token); // sliding window
    req.user = decoded;
    next();
  });
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

module.exports = {
  rateLimit,
  signToken,
  setSessionCookie,
  requireAuth,
  requireRole,
};
