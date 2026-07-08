/* ==========================================================================
   Routes — User management (/api/users*)
   Verbatim move from app.js. URLs, middleware, RBAC, validation and response
   shapes unchanged. Mounted at "/" so full paths are preserved.
     GET    /api/users        (list; requireRole ADMIN_ROLES)
     POST   /api/users        (create; SuperAdmin)
     PATCH  /api/users/:id    (update; SuperAdmin; self-demote guard)
     DELETE /api/users/:id    (delete; SuperAdmin; self-delete guard)
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { deptForRole } = require("../utils/permissions");
const { ADMIN_ROLES } = require("../config/constants");

const router = express.Router();

router.get(
  "/api/users",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const rows = await db.pAll(
      `SELECT id, username, email, role, department, brand, all_brands, all_outlets, region,
            pic_area, phone, is_active, can_close_override, default_outlet_code, created_at
       FROM users ORDER BY id ASC`,
    );
    // Attach PIC outlet coverage (used by the user modal / technician scope).
    for (const u of rows) {
      u.outlet_access = (
        await db.pAll(
          "SELECT outlet_code FROM user_outlet_access WHERE user_id = ?",
          [u.id],
        )
      ).map((r) => r.outlet_code);
    }
    res.json(rows);
  },
);

router.post(
  "/api/users",
  requireAuth,
  requireRole("SuperAdmin"),
  async (req, res) => {
    try {
      const {
        username,
        email,
        password,
        role,
        department,
        brand,
        all_brands,
        all_outlets,
        region,
        pic_area,
        phone,
        is_active,
        can_close_override,
        default_outlet_code,
        brand_access,
        outlet_access,
      } = req.body;
      if (!username || !email || !password || !role)
        return res
          .status(400)
          .json({ error: "username, email, password, role are required" });
      if (!db.APP_ROLES.includes(role))
        return res.status(400).json({ error: "Invalid role" });
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email))
        return res.status(400).json({ error: "Invalid email" });
      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
      if (!passwordRegex.test(password))
        return res
          .status(400)
          .json({ error: "Password does not meet complexity requirements" });
      const exists = await db.pGet(
        "SELECT id FROM users WHERE LOWER(email)=LOWER(?) OR LOWER(username)=LOWER(?)",
        [email, username],
      );
      if (exists)
        return res
          .status(400)
          .json({ error: "Username or email already in use" });

      const dept = deptForRole(role);
      const r = await db.pRun(
        `INSERT INTO users (username, email, password_hash, role, department, brand, all_brands, all_outlets, region, pic_area, phone, is_active, can_close_override, default_outlet_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          username,
          email.toLowerCase(),
          bcrypt.hashSync(password, 10),
          role,
          department || dept,
          brand || null,
          all_brands ? 1 : 0,
          all_outlets ? 1 : 0,
          region || null,
          pic_area || null,
          phone || null,
          is_active === 0 ? 0 : 1,
          can_close_override ? 1 : 0,
          default_outlet_code || null,
        ],
      );
      if (Array.isArray(brand_access))
        for (const bc of brand_access)
          await db.pRun(
            "INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)",
            [r.lastID, bc],
          );
      if (Array.isArray(outlet_access))
        for (const oc of outlet_access)
          await db.pRun(
            "INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)",
            [r.lastID, oc],
          );
      res.status(201).json({ id: r.lastID, username, email, role });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create user" });
    }
  },
);

router.patch(
  "/api/users/:id",
  requireAuth,
  requireRole("SuperAdmin"),
  async (req, res) => {
    try {
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId))
        return res.status(400).json({ error: "Invalid user ID" });
      const b = req.body || {};
      const updates = [];
      const params = [];
      const set = (c, v) => {
        updates.push(`${c} = ?`);
        params.push(v);
      };
      if (b.username) set("username", b.username);
      if (b.email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!re.test(b.email))
          return res.status(400).json({ error: "Invalid email" });
        set("email", b.email.toLowerCase());
      }
      if (b.role) {
        if (!db.APP_ROLES.includes(b.role))
          return res.status(400).json({ error: "Invalid role" });
        if (userId === req.user.id && b.role !== "SuperAdmin")
          return res
            .status(400)
            .json({ error: "You cannot change your own SuperAdmin role." });
        set("role", b.role);
        set("department", deptForRole(b.role));
      }
      if (b.password) {
        const re =
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{10,}$/;
        if (!re.test(b.password))
          return res
            .status(400)
            .json({ error: "Password does not meet complexity requirements" });
        set("password_hash", bcrypt.hashSync(b.password, 10));
      }
      if (b.brand !== undefined) set("brand", b.brand || null);
      if (b.all_brands !== undefined) set("all_brands", b.all_brands ? 1 : 0);
      if (b.all_outlets !== undefined)
        set("all_outlets", b.all_outlets ? 1 : 0);
      if (b.region !== undefined) set("region", b.region || null);
      if (b.pic_area !== undefined) set("pic_area", b.pic_area || null);
      if (b.phone !== undefined) set("phone", b.phone || null);
      if (b.is_active !== undefined) set("is_active", b.is_active ? 1 : 0);
      if (b.can_close_override !== undefined)
        set("can_close_override", b.can_close_override ? 1 : 0);
      if (b.default_outlet_code !== undefined)
        set("default_outlet_code", b.default_outlet_code || null);
      // Manual unlock
      if (b.unlock) {
        set("failed_attempts", 0);
        set("locked_until", null);
      }
      if (!updates.length)
        return res.status(400).json({ error: "No fields to update" });
      const r = await db.pRun(
        `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
        [...params, userId],
      );
      if (r.changes === 0)
        return res.status(404).json({ error: "User not found" });

      if (Array.isArray(b.brand_access)) {
        await db.pRun("DELETE FROM user_brand_access WHERE user_id = ?", [
          userId,
        ]);
        for (const bc of b.brand_access)
          await db.pRun(
            "INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)",
            [userId, bc],
          );
      }
      if (Array.isArray(b.outlet_access)) {
        await db.pRun("DELETE FROM user_outlet_access WHERE user_id = ?", [
          userId,
        ]);
        for (const oc of b.outlet_access)
          await db.pRun(
            "INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)",
            [userId, oc],
          );
      }
      res.json({ id: userId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update user" });
    }
  },
);

router.delete(
  "/api/users/:id",
  requireAuth,
  requireRole("SuperAdmin"),
  async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId))
      return res.status(400).json({ error: "Invalid user ID" });
    if (userId === req.user.id)
      return res
        .status(400)
        .json({ error: "You cannot delete your own account." });
    const r = await db.pRun("DELETE FROM users WHERE id = ?", [userId]);
    if (r.changes === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ success: true });
  },
);

module.exports = router;
