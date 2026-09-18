/* ==========================================================================
   Routes — Auth (/api/auth/*)
     POST /api/auth/login            (rate-limited on failures, lockout)
     POST /api/auth/logout
     GET  /api/auth/me
     POST /api/auth/change-password  (signs out every other session)
     POST /api/auth/register         (legacy; admin-only, creates a Requestor)
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../database");
const {
  rateLimit,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireRole,
  publicUser,
  bumpTokenVersion,
} = require("../middleware/auth");
const { validatePassword, EMAIL_RE } = require("../utils/validate");

const router = express.Router();

// A real bcrypt hash of a random string: comparing against it when the email
// is unknown keeps the response time the same as for a wrong password.
const DUMMY_HASH = bcrypt.hashSync(require("crypto").randomBytes(16).toString("hex"), 10);
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

// Public self-registration is DISABLED. Accounts are created only by admins via
// User Management (POST /api/users). This legacy endpoint stays admin-only.
router.post(
  "/api/auth/register",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME"),
  async (req, res) => {
    try {
      const { username, email, password, passwordConfirm, brand, outlet, phone } = req.body || {};
      if (!username || !email || !password || !passwordConfirm)
        return res.status(400).json({ error: "All fields are required" });
      if (password !== passwordConfirm)
        return res.status(400).json({ error: "Passwords do not match" });
      if (!EMAIL_RE.test(String(email)))
        return res.status(400).json({ error: "Invalid email address format" });
      const pwErr = validatePassword(password);
      if (pwErr) return res.status(400).json({ error: pwErr });

      const existing = await db.pGet(
        "SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)",
        [email, username],
      );
      if (existing)
        return res.status(400).json({ error: "Username or email already in use" });

      const passwordHash = await bcrypt.hash(password, 10);
      const r = await db.pRun(
        `INSERT INTO users (username, email, password_hash, role, brand, default_outlet_code, phone)
         VALUES (?, ?, ?, 'Requestor', ?, ?, ?)`,
        [String(username).trim(), String(email).toLowerCase().trim(), passwordHash, brand || null, outlet || null, phone || null],
      );
      if (brand)
        await db.pRun("INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)", [r.lastID, brand]);
      if (outlet)
        await db.pRun("INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)", [r.lastID, outlet]);
      res.status(201).json({ message: "Registration successful! Please log in." });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to register user" });
    }
  },
);

router.post(
  "/api/auth/login",
  // Only failures count, so a whole outlet signing in from one NAT'd IP is fine.
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, skipSuccessful: true }),
  async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password)
        return res.status(400).json({ error: "Email and password are required" });
      if (email.length > 254 || password.length > 256)
        return res.status(400).json({ error: "Invalid email or password" });

      const user = await db.pGet("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email.trim()]);
      const GENERIC = "Invalid email or password";
      if (!user) {
        await bcrypt.compare(password, DUMMY_HASH);
        return res.status(401).json({ error: GENERIC });
      }

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const mins = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000));
        return res.status(423).json({
          error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
        });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        const attempts = (user.failed_attempts || 0) + 1;
        const lockFor = attempts >= LOCK_AFTER ? new Date(Date.now() + LOCK_MS).toISOString() : null;
        await db.pRun(
          "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
          [lockFor ? 0 : attempts, lockFor, user.id],
        );
        return res.status(401).json({ error: GENERIC });
      }
      // Checked only after the password, so this does not reveal which emails exist.
      if (user.is_active === 0)
        return res.status(403).json({ error: "Account is inactive. Contact an administrator." });

      await db.pRun(
        "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
        [user.id],
      );
      const b = req.body;
      const rememberMe = b.remember_me === true || b.remember_me === "true" || b.rememberMe === true;
      setSessionCookie(res, signToken(user, rememberMe), rememberMe);
      res.json(publicUser(user));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Sign-in is temporarily unavailable." });
    }
  },
);

router.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true, message: "Logged out successfully" });
});

router.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

router.post(
  "/api/auth/change-password",
  requireAuth,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, skipSuccessful: true }),
  async (req, res) => {
    try {
      const body = req.body || {};
      const oldPw = body.oldPassword || body.old_password;
      const newPw = body.newPassword || body.new_password;
      const confirmPw = body.confirmPassword || body.confirm_password;

      if (!oldPw || !newPw || !confirmPw)
        return res.status(400).json({ error: "Current password, new password, and confirmation are required." });
      if (newPw !== confirmPw)
        return res.status(400).json({ error: "New password and confirmation do not match." });
      if (newPw === oldPw)
        return res.status(400).json({ error: "The new password must be different from the current one." });
      const pwErr = validatePassword(newPw);
      if (pwErr) return res.status(400).json({ error: pwErr });

      const user = await db.pGet("SELECT id, password_hash FROM users WHERE id = ?", [req.user.id]);
      if (!user || !(await bcrypt.compare(String(oldPw), user.password_hash)))
        return res.status(400).json({ error: "Incorrect current password." });

      await db.pRun("UPDATE users SET password_hash = ? WHERE id = ?", [
        await bcrypt.hash(newPw, 10),
        req.user.id,
      ]);
      // Sign out every other device, then re-issue this session on the new version.
      await bumpTokenVersion(req.user.id);
      const fresh = await db.pGet("SELECT id, token_version FROM users WHERE id = ?", [req.user.id]);
      setSessionCookie(res, signToken(fresh, false), false);
      res.json({ success: true, message: "Password updated. Other devices have been signed out." });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update password." });
    }
  },
);

module.exports = router;
