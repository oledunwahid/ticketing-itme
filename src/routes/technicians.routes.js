/* ==========================================================================
   Routes — Technicians & schedules (/api/technicians*)
   All: requireAuth + requireRole(ADMIN_ROLES). Mutations are department scoped.
     GET    /api/technicians                          list + open workload
                                                      (?include=schedules bundles
                                                       schedules + unavailability)
     GET    /api/technicians/:id/schedules            schedules + unavailability
     POST   /api/technicians/:id/schedules            add working hours
     DELETE /api/technicians/:id/schedules/:sid       remove working hours
     POST   /api/technicians/:id/unavailability       add day off / block
     DELETE /api/technicians/:id/unavailability/:uid  remove day off / block
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ADMIN_ROLES } = require("../config/constants");
const { OPEN_ASSIGNED_STATUSES } = require("../../services/recommend");
const { TIME_RE, ValidationError, optStr, optDateTime } = require("../utils/validate");

const router = express.Router();

function canManageTechnician(user, tech) {
  if (user.role === "SuperAdmin") return true;
  if (user.role === "AdminIT") return tech.role === "TechnicianIT";
  if (user.role === "AdminME") return tech.role === "TechnicianME";
  return false;
}

async function loadTech(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const tech = Number.isInteger(id)
    ? await db.pGet(
        "SELECT id, role FROM users WHERE id = ? AND role IN ('TechnicianIT','TechnicianME')",
        [id],
      )
    : null;
  if (!tech) {
    res.status(404).json({ error: "Technician not found" });
    return null;
  }
  if (!canManageTechnician(req.user, tech)) {
    res.status(403).json({ error: "Not permitted for this department" });
    return null;
  }
  return tech;
}

const fail = (res, e, msg) => {
  if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: msg });
};

router.get("/api/technicians", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    let where = "u.role IN ('TechnicianIT','TechnicianME')";
    if (req.query.department === "IT") where = "u.role = 'TechnicianIT'";
    else if (req.query.department === "ME") where = "u.role = 'TechnicianME'";
    if (req.query.active === "1") where += " AND u.is_active = 1";
    const techs = await db.pAll(
      `SELECT u.id, u.username, u.email, u.phone, u.department, u.role, u.is_active, u.region, u.pic_area,
              COUNT(t.id) AS workload
         FROM users u
         LEFT JOIN tickets t
           ON t.assigned_technician_id = u.id
          AND t.status IN (${OPEN_ASSIGNED_STATUSES.map(() => "?").join(",")})
        WHERE ${where}
        GROUP BY u.id
        ORDER BY u.username COLLATE NOCASE`,
      OPEN_ASSIGNED_STATUSES,
    );
    if (req.query.include === "schedules" && techs.length) {
      const ids = techs.map((t) => t.id);
      const ph = ids.map(() => "?").join(",");
      const [schedules, unavailability] = await Promise.all([
        db.pAll(`SELECT * FROM technician_schedules WHERE user_id IN (${ph}) ORDER BY day_of_week, start_time`, ids),
        db.pAll(`SELECT * FROM technician_unavailability WHERE user_id IN (${ph}) ORDER BY start_datetime DESC`, ids),
      ]);
      const byId = new Map(techs.map((t) => [t.id, Object.assign(t, { schedules: [], unavailability: [] })]));
      for (const s of schedules) byId.get(s.user_id).schedules.push(s);
      for (const u of unavailability) byId.get(u.user_id).unavailability.push(u);
    }
    res.json(techs);
  } catch (e) {
    fail(res, e, "Failed to list technicians");
  }
});

router.get("/api/technicians/:id/schedules", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid technician" });
    const [schedules, unavailability] = await Promise.all([
      db.pAll("SELECT * FROM technician_schedules WHERE user_id = ? ORDER BY day_of_week, start_time", [id]),
      db.pAll("SELECT * FROM technician_unavailability WHERE user_id = ? ORDER BY start_datetime DESC", [id]),
    ]);
    res.json({ schedules, unavailability });
  } catch (e) {
    fail(res, e, "Failed to load schedules");
  }
});

router.post("/api/technicians/:id/schedules", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const tech = await loadTech(req, res);
    if (!tech) return;
    const { day_of_week, start_time, end_time } = req.body || {};
    const dow = Number(day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6)
      return res.status(400).json({ error: "Day must be between Sunday (0) and Saturday (6)" });
    if (!TIME_RE.test(String(start_time)) || !TIME_RE.test(String(end_time)))
      return res.status(400).json({ error: "Times must be in HH:MM format" });
    if (end_time <= start_time)
      return res.status(400).json({ error: "End time must be after start time" });
    const overlap = await db.pGet(
      `SELECT start_time, end_time FROM technician_schedules
        WHERE user_id = ? AND day_of_week = ? AND active = 1 AND start_time < ? AND end_time > ?`,
      [tech.id, dow, end_time, start_time],
    );
    if (overlap)
      return res.status(409).json({
        error: `Overlaps existing hours ${overlap.start_time}–${overlap.end_time} on that day`,
      });
    const r = await db.pRun(
      "INSERT INTO technician_schedules (user_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)",
      [tech.id, dow, start_time, end_time],
    );
    res.status(201).json(await db.pGet("SELECT * FROM technician_schedules WHERE id = ?", [r.lastID]));
  } catch (e) {
    fail(res, e, "Failed to save schedule");
  }
});

router.delete("/api/technicians/:id/schedules/:sid", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const tech = await loadTech(req, res);
    if (!tech) return;
    const r = await db.pRun(
      "DELETE FROM technician_schedules WHERE id = ? AND user_id = ?",
      [req.params.sid, tech.id],
    );
    if (!r.changes) return res.status(404).json({ error: "Working hours not found" });
    res.json({ success: true });
  } catch (e) {
    fail(res, e, "Failed to remove schedule");
  }
});

router.post("/api/technicians/:id/unavailability", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const tech = await loadTech(req, res);
    if (!tech) return;
    const b = req.body || {};
    const start = optDateTime(b.start_datetime, "From");
    const end = optDateTime(b.end_datetime, "To");
    if (!start || !end)
      return res.status(400).json({ error: "Both From and To are required" });
    if (Date.parse(end) <= Date.parse(start))
      return res.status(400).json({ error: "The end must be after the start" });
    const r = await db.pRun(
      "INSERT INTO technician_unavailability (user_id, start_datetime, end_datetime, reason) VALUES (?, ?, ?, ?)",
      [tech.id, start, end, optStr(b.reason, 200, "Reason")],
    );
    res.status(201).json(await db.pGet("SELECT * FROM technician_unavailability WHERE id = ?", [r.lastID]));
  } catch (e) {
    fail(res, e, "Failed to save day off");
  }
});

router.delete("/api/technicians/:id/unavailability/:uid", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const tech = await loadTech(req, res);
    if (!tech) return;
    const r = await db.pRun(
      "DELETE FROM technician_unavailability WHERE id = ? AND user_id = ?",
      [req.params.uid, tech.id],
    );
    if (!r.changes) return res.status(404).json({ error: "Block not found" });
    res.json({ success: true });
  } catch (e) {
    fail(res, e, "Failed to remove day off");
  }
});

module.exports = router;
