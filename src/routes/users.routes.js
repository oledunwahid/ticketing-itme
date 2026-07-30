/* ==========================================================================
   Routes — User management (/api/users*)
   Mounted at "/" so full paths are preserved. Access is limited to the user
   module roles (SuperAdmin + AdminIT); AdminIT is scoped to IT-side target
   roles via canManageTargetRole (see src/utils/permissions.js).
     GET    /api/users        (list; SuperAdmin/AdminIT; rows scoped to caller)
     POST   /api/users        (create; SuperAdmin/AdminIT; target-role scoped)
     PATCH  /api/users/:id    (update; SuperAdmin/AdminIT; target+role scoped; self-demote guard)
     DELETE /api/users/:id    (delete; SuperAdmin/AdminIT; target scoped; self-delete guard)
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  deptForRole,
  canManageTargetRole,
} = require("../utils/permissions");

const router = express.Router();

// Roles allowed into the Users module. SuperAdmin manages all users; AdminIT/AdminME
// manage their scoped department target roles via canManageTargetRole.
const USER_MODULE_ROLES = ["SuperAdmin", "AdminIT", "AdminME"];

router.get(
  "/api/users",
  requireAuth,
  requireRole(USER_MODULE_ROLES),
  async (req, res) => {
    let rows = await db.pAll(
      `SELECT id, username, email, role, department, brand, all_brands, all_outlets, region,
            pic_area, phone, is_active, can_close_override, default_outlet_code, created_at
       FROM users ORDER BY id ASC`,
    );
    // Scope the list to what the caller may manage. SuperAdmin sees everyone;
    // AdminIT only sees IT-side roles (never SuperAdmin/AdminME/TechnicianME).
    rows = rows.filter((u) => canManageTargetRole(req.user.role, u.role));
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
  requireRole(USER_MODULE_ROLES),
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
      // Scope guard: AdminIT may only create IT-side roles. Blocks payload
      // tampering (e.g. AdminIT trying to mint a SuperAdmin/AdminME account).
      if (!canManageTargetRole(req.user.role, role))
        return res
          .status(403)
          .json({ error: "Forbidden. You cannot create a user with this role." });
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
  requireRole(USER_MODULE_ROLES),
  async (req, res) => {
    try {
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId))
        return res.status(400).json({ error: "Invalid user ID" });
      const b = req.body || {};
      // Scope guard: the caller must be allowed to manage the target's CURRENT
      // role before any edit. Stops AdminIT touching SuperAdmin/AdminME/etc via
      // a direct API call, even though those users are hidden from their list.
      const target = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
        userId,
      ]);
      if (!target) return res.status(404).json({ error: "User not found" });
      if (!canManageTargetRole(req.user.role, target.role))
        return res
          .status(403)
          .json({ error: "Forbidden. You cannot manage this user." });
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
        // Scope guard: the NEW role must also be manageable. Blocks AdminIT
        // from escalating anyone (incl. themselves) to SuperAdmin/AdminME/etc.
        if (!canManageTargetRole(req.user.role, b.role))
          return res
            .status(403)
            .json({ error: "Forbidden. You cannot assign this role." });
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
  requireRole(USER_MODULE_ROLES),
  async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId))
      return res.status(400).json({ error: "Invalid user ID" });
    if (userId === req.user.id)
      return res
        .status(400)
        .json({ error: "You cannot delete your own account." });
    // Scope guard: AdminIT can only delete IT-side users; never SuperAdmin/ME.
    const target = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
      userId,
    ]);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (!canManageTargetRole(req.user.role, target.role))
      return res
        .status(403)
        .json({ error: "Forbidden. You cannot delete this user." });

    // In use → refuse, and point at the Active toggle. A deleted user would
    // strand the tickets they reported or are assigned to, and their name would
    // vanish from the activity log and every performance report.
    const owner = await db.pGet(
      `SELECT
         (SELECT COUNT(*) FROM tickets WHERE assigned_technician_id = ?) AS assigned,
         (SELECT COUNT(*) FROM tickets WHERE requestor_user_id = ?)      AS reported`,
      [userId, userId],
    );
    const refs = (owner.assigned || 0) + (owner.reported || 0);
    if (refs > 0) {
      const parts = [];
      if (owner.assigned) parts.push(`${owner.assigned} assigned ticket(s)`);
      if (owner.reported) parts.push(`${owner.reported} reported ticket(s)`);
      const who = await db.pGet("SELECT username FROM users WHERE id = ?", [userId]);
      return res.status(409).json({
        error:
          `${who ? who.username : "This user"} has ${parts.join(" and ")} and cannot be ` +
          `deleted. Switch Active off in Edit instead — the account can no longer sign in ` +
          `but its ticket history stays intact.`,
        in_use: true,
        used_by: refs,
      });
    }

    const r = await db.pRun("DELETE FROM users WHERE id = ?", [userId]);
    if (r.changes === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ success: true });
  },
);

module.exports = router;
