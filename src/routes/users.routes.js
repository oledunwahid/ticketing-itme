/* ==========================================================================
   Routes — User management (/api/users*)
   Access: SuperAdmin + AdminIT + AdminME. Department admins are scoped to
   their side's target roles via canManageTargetRole (src/utils/permissions).
     GET    /api/users        (list; rows scoped to caller)
     POST   /api/users        (create; target-role scoped)
     PATCH  /api/users/:id    (update; target+role scoped; self-lockout guards)
     DELETE /api/users/:id    (delete; target scoped; in-use guard)

   Guards against locking the organisation out:
     • nobody can change their own role or deactivate themselves
     • the last active SuperAdmin can never be demoted, deactivated or deleted
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../database");
const { requireAuth, requireRole, bumpTokenVersion } = require("../middleware/auth");
const { deptForRole, canManageTargetRole } = require("../utils/permissions");
const {
  EMAIL_RE,
  LIMITS,
  ValidationError,
  validatePassword,
  optStr,
  optPhone,
} = require("../utils/validate");
const { REGIONS } = require("../config/constants");

const router = express.Router();

const USER_MODULE_ROLES = ["SuperAdmin", "AdminIT", "AdminME"];

const codeList = (v) =>
  Array.isArray(v)
    ? [...new Set(v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 40)))].slice(0, 500)
    : null;

async function activeSuperAdmins(excludeId) {
  const r = await db.pGet(
    "SELECT COUNT(*) c FROM users WHERE role = 'SuperAdmin' AND is_active = 1 AND id != ?",
    [excludeId],
  );
  return r.c;
}

function handleError(res, e, fallback) {
  if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
  if (e && /UNIQUE constraint failed: users\.(email|username)/.test(e.message))
    return res.status(400).json({ error: "Username or email already in use" });
  console.error(e);
  res.status(500).json({ error: fallback });
}

router.get("/api/users", requireAuth, requireRole(USER_MODULE_ROLES), async (req, res) => {
  try {
    const rows = (
      await db.pAll(
        `SELECT id, username, email, role, department, brand, all_brands, all_outlets, region,
                pic_area, phone, is_active, can_close_override, default_outlet_code, created_at,
                last_login_at,
                CASE WHEN locked_until IS NOT NULL AND locked_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     THEN 1 ELSE 0 END AS is_locked
           FROM users ORDER BY username COLLATE NOCASE ASC`,
      )
    ).filter((u) => canManageTargetRole(req.user.role, u.role));

    // PIC outlet coverage in one query instead of one per user.
    const access = await db.pAll("SELECT user_id, outlet_code FROM user_outlet_access");
    const byUser = new Map();
    for (const a of access) {
      if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
      byUser.get(a.user_id).push(a.outlet_code);
    }
    for (const u of rows) u.outlet_access = byUser.get(u.id) || [];
    res.json(rows);
  } catch (e) {
    handleError(res, e, "Failed to load users");
  }
});

router.post("/api/users", requireAuth, requireRole(USER_MODULE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const username = optStr(b.username, LIMITS.name, "Name");
    const email = optStr(b.email, 254, "Email");
    const { password, role } = b;
    if (!username || !email || !password || !role)
      return res.status(400).json({ error: "Name, email, password and role are required" });
    if (!db.APP_ROLES.includes(role))
      return res.status(400).json({ error: "Invalid role" });
    if (!canManageTargetRole(req.user.role, role))
      return res.status(403).json({ error: "Forbidden. You cannot create a user with this role." });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email" });
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const region = optStr(b.region, 40, "Region");
    if (region && !REGIONS.includes(region))
      return res.status(400).json({ error: "Unknown region" });

    const exists = await db.pGet(
      "SELECT id FROM users WHERE LOWER(email)=LOWER(?) OR LOWER(username)=LOWER(?)",
      [email, username],
    );
    if (exists) return res.status(400).json({ error: "Username or email already in use" });

    const r = await db.pRun(
      `INSERT INTO users (username, email, password_hash, role, department, brand, all_brands, all_outlets, region, pic_area, phone, is_active, can_close_override, default_outlet_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        email.toLowerCase(),
        await bcrypt.hash(password, 10),
        role,
        deptForRole(role),
        optStr(b.brand, 40, "Brand"),
        b.all_brands ? 1 : 0,
        b.all_outlets ? 1 : 0,
        region,
        optStr(b.pic_area, 80, "PIC area"),
        optPhone(b.phone),
        b.is_active === 0 || b.is_active === false ? 0 : 1,
        b.can_close_override ? 1 : 0,
        optStr(b.default_outlet_code, 40, "Default outlet"),
      ],
    );
    for (const bc of codeList(b.brand_access) || [])
      await db.pRun("INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)", [r.lastID, bc]);
    for (const oc of codeList(b.outlet_access) || [])
      await db.pRun("INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)", [r.lastID, oc]);
    res.status(201).json({ id: r.lastID, username, email: email.toLowerCase(), role });
  } catch (e) {
    handleError(res, e, "Failed to create user");
  }
});

router.patch("/api/users/:id", requireAuth, requireRole(USER_MODULE_ROLES), async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: "Invalid user ID" });
    const b = req.body || {};
    const target = await db.pGet("SELECT id, role, is_active FROM users WHERE id = ?", [userId]);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (!canManageTargetRole(req.user.role, target.role))
      return res.status(403).json({ error: "Forbidden. You cannot manage this user." });
    const isSelf = userId === req.user.id;

    const updates = [];
    const params = [];
    const set = (c, v) => {
      updates.push(`${c} = ?`);
      params.push(v);
    };
    let revokeSessions = false;

    if (b.username !== undefined) {
      const username = optStr(b.username, LIMITS.name, "Name");
      if (!username) return res.status(400).json({ error: "Name cannot be empty" });
      const clash = await db.pGet("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?", [username, userId]);
      if (clash) return res.status(400).json({ error: "That name is already used by another account" });
      set("username", username);
    }
    if (b.email !== undefined) {
      const email = optStr(b.email, 254, "Email");
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email" });
      const clash = await db.pGet("SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?", [email, userId]);
      if (clash) return res.status(400).json({ error: "That email is already used by another account" });
      set("email", email.toLowerCase());
    }
    if (b.role !== undefined && b.role !== target.role) {
      if (!db.APP_ROLES.includes(b.role)) return res.status(400).json({ error: "Invalid role" });
      if (!canManageTargetRole(req.user.role, b.role))
        return res.status(403).json({ error: "Forbidden. You cannot assign this role." });
      if (isSelf) return res.status(400).json({ error: "You cannot change your own role." });
      if (target.role === "SuperAdmin" && (await activeSuperAdmins(userId)) === 0)
        return res.status(400).json({ error: "This is the last active SuperAdmin. Promote someone else first." });
      set("role", b.role);
      set("department", deptForRole(b.role));
      revokeSessions = true;
    }
    if (b.password) {
      const pwErr = validatePassword(b.password);
      if (pwErr) return res.status(400).json({ error: pwErr });
      set("password_hash", await bcrypt.hash(b.password, 10));
      // An admin reset signs the user out everywhere — but never the admin
      // resetting their own password from this screen mid-session.
      if (!isSelf) revokeSessions = true;
    }
    if (b.is_active !== undefined) {
      const active = b.is_active ? 1 : 0;
      if (!active && isSelf) return res.status(400).json({ error: "You cannot deactivate your own account." });
      if (!active && target.role === "SuperAdmin" && target.is_active && (await activeSuperAdmins(userId)) === 0)
        return res.status(400).json({ error: "This is the last active SuperAdmin and cannot be deactivated." });
      set("is_active", active);
      if (!active) revokeSessions = true;
    }
    if (b.region !== undefined) {
      const region = optStr(b.region, 40, "Region");
      if (region && !REGIONS.includes(region)) return res.status(400).json({ error: "Unknown region" });
      set("region", region);
    }
    if (b.brand !== undefined) set("brand", optStr(b.brand, 40, "Brand"));
    if (b.all_brands !== undefined) set("all_brands", b.all_brands ? 1 : 0);
    if (b.all_outlets !== undefined) set("all_outlets", b.all_outlets ? 1 : 0);
    if (b.pic_area !== undefined) set("pic_area", optStr(b.pic_area, 80, "PIC area"));
    if (b.phone !== undefined) set("phone", optPhone(b.phone));
    if (b.can_close_override !== undefined) set("can_close_override", b.can_close_override ? 1 : 0);
    if (b.default_outlet_code !== undefined)
      set("default_outlet_code", optStr(b.default_outlet_code, 40, "Default outlet"));
    if (b.unlock) {
      set("failed_attempts", 0);
      set("locked_until", null);
    }
    const brandAccess = codeList(b.brand_access);
    const outletAccess = codeList(b.outlet_access);
    if (!updates.length && !brandAccess && !outletAccess)
      return res.status(400).json({ error: "No fields to update" });

    // Everything is validated above, so the writes below only fail on I/O.
    if (updates.length)
      await db.pRun(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, [...params, userId]);
    if (brandAccess) {
      await db.pRun("DELETE FROM user_brand_access WHERE user_id = ?", [userId]);
      for (const bc of brandAccess)
        await db.pRun("INSERT OR IGNORE INTO user_brand_access (user_id, brand_code) VALUES (?, ?)", [userId, bc]);
    }
    if (outletAccess) {
      await db.pRun("DELETE FROM user_outlet_access WHERE user_id = ?", [userId]);
      for (const oc of outletAccess)
        await db.pRun("INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)", [userId, oc]);
    }
    if (revokeSessions) await bumpTokenVersion(userId);
    res.json({ id: userId, sessions_revoked: revokeSessions });
  } catch (e) {
    handleError(res, e, "Failed to update user");
  }
});

router.delete("/api/users/:id", requireAuth, requireRole(USER_MODULE_ROLES), async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: "Invalid user ID" });
    if (userId === req.user.id)
      return res.status(400).json({ error: "You cannot delete your own account." });
    const target = await db.pGet("SELECT id, role, username, is_active FROM users WHERE id = ?", [userId]);
    if (!target) return res.status(404).json({ error: "User not found" });
    if (!canManageTargetRole(req.user.role, target.role))
      return res.status(403).json({ error: "Forbidden. You cannot delete this user." });
    if (target.role === "SuperAdmin" && target.is_active && (await activeSuperAdmins(userId)) === 0)
      return res.status(400).json({ error: "The last active SuperAdmin cannot be deleted." });

    // In use → refuse, and point at the Active toggle. A deleted user would
    // strand their tickets and vanish from the activity log and reports.
    const owner = await db.pGet(
      `SELECT
         (SELECT COUNT(*) FROM tickets WHERE assigned_technician_id = ?) AS assigned,
         (SELECT COUNT(*) FROM tickets WHERE requestor_user_id = ?)      AS reported,
         (SELECT COUNT(*) FROM ticket_assignments WHERE technician_id = ?) AS team`,
      [userId, userId, userId],
    );
    const refs = (owner.assigned || 0) + (owner.reported || 0) + (owner.team || 0);
    if (refs > 0) {
      const parts = [];
      if (owner.assigned) parts.push(`${owner.assigned} assigned ticket(s)`);
      if (owner.reported) parts.push(`${owner.reported} reported ticket(s)`);
      if (owner.team && !owner.assigned) parts.push(`${owner.team} assignment record(s)`);
      return res.status(409).json({
        error:
          `${target.username} has ${parts.join(" and ")} and cannot be deleted. ` +
          `Switch Active off in Edit instead. The account can no longer sign in ` +
          `but its ticket history stays intact.`,
        in_use: true,
        used_by: refs,
      });
    }

    const r = await db.pRun("DELETE FROM users WHERE id = ?", [userId]);
    if (r.changes === 0) return res.status(404).json({ error: "User not found" });
    res.json({ success: true });
  } catch (e) {
    handleError(res, e, "Failed to delete user");
  }
});

module.exports = router;
