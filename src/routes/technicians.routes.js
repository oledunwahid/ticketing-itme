/* ==========================================================================
   Routes — Technicians & schedules (/api/technicians*)
   Phase 2.5A: verbatim move from app.js. URLs, middleware, RBAC, validation
   and response shapes unchanged. Mounted at "/" so full paths are preserved.

   Endpoints (all: requireAuth + requireRole(ADMIN_ROLES)):
     GET    /api/technicians                      (list + open workload count)
     GET    /api/technicians/:id/schedules        (schedules + unavailability)
     POST   /api/technicians/:id/schedules        (add schedule)
     DELETE /api/technicians/:id/schedules/:sid   (remove schedule)
     POST   /api/technicians/:id/unavailability   (add unavailability)
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ADMIN_ROLES } = require("../config/constants");
const { OPEN_ASSIGNED_STATUSES } = require("../../services/recommend");

const router = express.Router();

// Department-scoped management check (used by schedule/unavailability mutations).
function canManageTechnician(user, tech) {
  if (user.role === "SuperAdmin") return true;
  if (user.role === "AdminIT") return tech.role === "TechnicianIT";
  if (user.role === "AdminME") return tech.role === "TechnicianME";
  return false;
}

router.get(
  "/api/technicians",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const dept = req.query.department;
      let sql = `SELECT id, username, email, department, role, is_active FROM users
               WHERE role IN ('TechnicianIT','TechnicianME')`;
      const params = [];
      if (dept === "IT") {
        sql += " AND role = 'TechnicianIT'";
      } else if (dept === "ME") {
        sql += " AND role = 'TechnicianME'";
      }
      sql += " ORDER BY username";
      const techs = await db.pAll(sql, params);
      for (const t of techs) {
        const wl = await db.pGet(
          `SELECT COUNT(*) c FROM tickets WHERE assigned_technician_id = ? AND status IN (${OPEN_ASSIGNED_STATUSES.map(() => "?").join(",")})`,
          [t.id, ...OPEN_ASSIGNED_STATUSES],
        );
        t.workload = wl.c;
      }
      res.json(techs);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list technicians" });
    }
  },
);

router.get(
  "/api/technicians/:id/schedules",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const schedules = await db.pAll(
      "SELECT * FROM technician_schedules WHERE user_id = ? ORDER BY day_of_week",
      [req.params.id],
    );
    const unavailability = await db.pAll(
      "SELECT * FROM technician_unavailability WHERE user_id = ? ORDER BY start_datetime DESC",
      [req.params.id],
    );
    res.json({ schedules, unavailability });
  },
);

router.post(
  "/api/technicians/:id/schedules",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const tech = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
        req.params.id,
      ]);
      if (!tech) return res.status(404).json({ error: "Technician not found" });
      if (!canManageTechnician(req.user, tech))
        return res
          .status(403)
          .json({ error: "Not permitted for this department" });
      const { day_of_week, start_time, end_time } = req.body || {};
      if (day_of_week == null || !start_time || !end_time)
        return res
          .status(400)
          .json({ error: "day_of_week, start_time, end_time required" });
      const r = await db.pRun(
        "INSERT INTO technician_schedules (user_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)",
        [tech.id, day_of_week, start_time, end_time],
      );
      res
        .status(201)
        .json(
          await db.pGet("SELECT * FROM technician_schedules WHERE id = ?", [
            r.lastID,
          ]),
        );
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to save schedule" });
    }
  },
);

router.delete(
  "/api/technicians/:id/schedules/:sid",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const tech = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (!tech || !canManageTechnician(req.user, tech))
      return res.status(403).json({ error: "Not permitted" });
    await db.pRun(
      "DELETE FROM technician_schedules WHERE id = ? AND user_id = ?",
      [req.params.sid, req.params.id],
    );
    res.json({ success: true });
  },
);

router.post(
  "/api/technicians/:id/unavailability",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const tech = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (!tech || !canManageTechnician(req.user, tech))
      return res.status(403).json({ error: "Not permitted" });
    const { start_datetime, end_datetime, reason } = req.body || {};
    if (!start_datetime || !end_datetime)
      return res
        .status(400)
        .json({ error: "start_datetime and end_datetime required" });
    const r = await db.pRun(
      "INSERT INTO technician_unavailability (user_id, start_datetime, end_datetime, reason) VALUES (?, ?, ?, ?)",
      [tech.id, start_datetime, end_datetime, reason || null],
    );
    res
      .status(201)
      .json(
        await db.pGet("SELECT * FROM technician_unavailability WHERE id = ?", [
          r.lastID,
        ]),
      );
  },
);

router.delete(
  "/api/technicians/:id/unavailability/:uid",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    const tech = await db.pGet("SELECT id, role FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (!tech || !canManageTechnician(req.user, tech))
      return res.status(403).json({ error: "Not permitted" });
    await db.pRun(
      "DELETE FROM technician_unavailability WHERE id = ? AND user_id = ?",
      [req.params.uid, req.params.id],
    );
    res.json({ success: true });
  },
);

module.exports = router;
