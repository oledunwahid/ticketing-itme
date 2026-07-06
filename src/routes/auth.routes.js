/* ==========================================================================
   Routes — Auth (/api/auth/*)
   Verbatim move of the auth route handlers from app.js. URLs, middleware
   order, validation and response shapes are unchanged. Mounted at "/" so the
   full "/api/auth/..." paths are preserved.
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../database");
const {
  rateLimit,
  signToken,
  setSessionCookie,
  requireAuth,
} = require("../middleware/auth");

const router = express.Router();

router.post(
  "/api/auth/register",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
  async (req, res) => {
    try {
      const {
        username,
        email,
        password,
        passwordConfirm,
        brand,
        outlet,
        phone,
      } = req.body;
      if (!username || !email || !password || !passwordConfirm) {
        return res.status(400).json({ error: "All fields are required" });
      }
      if (password !== passwordConfirm)
        return res.status(400).json({ error: "Passwords do not match" });
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email))
        return res.status(400).json({ error: "Invalid email address format" });
      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
      if (!passwordRegex.test(password))
        return res
          .status(400)
          .json({ error: "Password does not meet complexity requirements" });

      const existing = await db.pGet(
        "SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)",
        [email, username],
      );
      if (existing)
        return res
          .status(400)
          .json({ error: "Username or email already in use" });

      const passwordHash = bcrypt.hashSync(password, 10);
      // Self-registration always creates a Requestor.
      const r = await db.pRun(
        `INSERT INTO users (username, email, password_hash, role, brand, default_outlet_code, phone)
       VALUES (?, ?, ?, 'Requestor', ?, ?, ?)`,
        [
          username,
          email.toLowerCase(),
          passwordHash,
          brand || null,
          outlet || null,
          phone || null,
        ],
      );
      if (brand)
        await db.pRun(
          "INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)",
          [r.lastID, brand],
        );
      if (outlet)
        await db.pRun(
          "INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)",
          [r.lastID, outlet],
        );
      res
        .status(201)
        .json({ message: "Registration successful! Please log in." });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to register user" });
    }
  },
);

router.post(
  "/api/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res
          .status(400)
          .json({ error: "Email and password are required" });

      const user = await db.pGet(
        "SELECT * FROM users WHERE LOWER(email) = LOWER(?)",
        [email],
      );
      // Generic error to avoid user enumeration.
      const GENERIC = "Invalid email or password";
      if (!user) return res.status(401).json({ error: GENERIC });

      // Account lockout check
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res
          .status(423)
          .json({
            error:
              "Account temporarily locked due to failed attempts. Try again later.",
          });
      }
      if (user.is_active === 0)
        return res
          .status(403)
          .json({ error: "Account is inactive. Contact an administrator." });

      if (!bcrypt.compareSync(password, user.password_hash)) {
        const attempts = (user.failed_attempts || 0) + 1;
        const lockFor =
          attempts >= 5
            ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
            : null;
        await db.pRun(
          "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
          [attempts, lockFor, user.id],
        );
        return res.status(401).json({ error: GENERIC });
      }

      // Success — reset lockout counters.
      await db.pRun(
        "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
        [user.id],
      );
      const token = signToken(user);
      setSessionCookie(res, token);
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        department: user.department,
        brand: user.brand,
        all_brands: user.all_brands,
        can_close_override: user.can_close_override,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Database error" });
    }
  },
);

router.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true, message: "Logged out successfully" });
});

router.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
    role: req.user.role,
    department: req.user.department,
    brand: req.user.brand,
    all_brands: req.user.all_brands,
    can_close_override: req.user.can_close_override,
  });
});

module.exports = router;
