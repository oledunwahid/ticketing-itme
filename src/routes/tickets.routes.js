/* ==========================================================================
   Routes — Tickets & dashboard
     GET   /api/tickets                              scoped list (+ SLA fields)
     GET   /api/tickets/export                       scoped list as CSV
     GET   /api/tickets/:id                          scoped detail bundle
     GET   /api/dashboard                            scoped metrics
     GET   /api/tickets/:id/recommend                admin: ranked technicians
     POST  /api/tickets/:id/comments                 reply (+ attachments)
     PATCH /api/tickets/:id                          status / fields
     POST  /api/tickets/:id/assign                   admin: team management
     GET   /api/tickets/:id/assignable-technicians   invite candidates
     POST  /api/tickets/:id/collaborators/invite     technician invite
     POST  /api/tickets/:id/assign-to-me             technician self-assign
     POST  /api/tickets                              create
   ========================================================================== */
const express = require("express");
const crypto = require("crypto");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { APP_URL } = require("../config/env");
const {
  buildTicketScope,
  isAdmin,
  isTechnician,
  deptForRole,
  adminScopeForTicket,
  canClose,
  technicianDeptMatches,
} = require("../utils/permissions");
const { getVisibleTicket, toClientTicket } = require("../services/tickets.service");
const {
  TERMINAL_STATUSES,
  actorLabel,
  getTeam,
  teamRoleOf,
  loadAssignableTechnician,
  setPrimary,
  addCollaborator,
  removeAssignment,
} = require("../services/assignment.service");
const { validateTransition } = require("../utils/statusTransition");
const { insertWithNumber } = require("../utils/ticketNumber");
const { logActivity } = require("../services/auditLog.service");
const { normalizeIds } = require("../services/upload.service");
const {
  DEPARTMENTS,
  URGENCIES,
  ADMIN_ROLES,
  STATUSES,
  STATUS_GROUPS,
  statusGroup,
  statusesInGroup,
  TECHNICIAN_STATUSES,
  WAITING_STATUSES,
} = require("../config/constants");
const {
  recommendTechnicians,
  OPEN_ASSIGNED_STATUSES,
} = require("../../services/recommend");
const { notify, alertNewTicket } = require("../../services/notifications");
const { toCsv } = require("../utils/csv");
const { getSlaTargets, enrichTicket, ms: parseMs, avg } = require("../utils/reporting");
const {
  LIMITS,
  ValidationError,
  optStr,
  optDateTime,
  optPhone,
  EMAIL_RE,
} = require("../utils/validate");

const router = express.Router();

const LIST_CAP = 5000;
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => "\\" + c);

function sendError(res, e, fallback) {
  if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: fallback });
}

// --------------------------------------------------------------------------
// Shared list query — the scope clause, filters and ordering used by BOTH the
// ticket list and the CSV export, so an export can never widen (or narrow)
// what the list on screen shows. The scope clause references the tickets
// table by bare column names, so callers must keep the table unaliased.
// --------------------------------------------------------------------------
async function buildTicketListQuery(user, query) {
  const q = query || {};
  const str = (v) => (typeof v === "string" ? v.trim().slice(0, 120) : "");
  const scope = await buildTicketScope(user, { techFilter: str(q.scope) });
  let where = scope.clause;
  const params = [...scope.params];
  const add = (frag, ...vals) => {
    where += frag;
    params.push(...vals);
  };

  const status = str(q.status);
  if (status) add(" AND status = ?", status);
  const group = str(q.status_group);
  if (group && STATUS_GROUPS.includes(group)) {
    const members = statusesInGroup(group);
    add(` AND status IN (${members.map(() => "?").join(",")})`, ...members);
  }
  const urgency = str(q.urgency) || str(q.priority);
  if (urgency) add(" AND urgency = ?", urgency);
  if (DEPARTMENTS.includes(str(q.department))) add(" AND department = ?", str(q.department));
  if (str(q.brand)) add(" AND brand_code = ?", str(q.brand));
  if (str(q.outlet)) add(" AND outlet_code = ?", str(q.outlet));
  if (str(q.region)) add(" AND region = ?", str(q.region));
  if (str(q.category)) add(" AND category = ?", str(q.category));
  if (q.assigned === "no" || q.assigned === "unassigned")
    add(" AND assigned_technician_id IS NULL AND status NOT IN ('Closed','Cancelled')");
  if (q.open === "1") add(" AND status NOT IN ('Resolved','Closed','Cancelled')");
  const search = str(q.search);
  if (search) {
    const s = `%${likeEscape(search)}%`;
    add(
      " AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR ticket_number LIKE ? ESCAPE '\\'" +
        " OR customer_name LIKE ? ESCAPE '\\' OR customer_email LIKE ? ESCAPE '\\' OR outlet_code LIKE ? ESCAPE '\\'" +
        " OR assignee_name LIKE ? ESCAPE '\\')",
      s, s, s, s, s, s, s,
    );
  }

  // Default sort is newest-first. Urgency ordering only when asked for.
  let orderBy;
  if (q.sort === "created_asc") orderBy = " ORDER BY created_at ASC, id ASC";
  else if (q.sort === "updated") orderBy = " ORDER BY COALESCE(updated_at, created_at) DESC, id DESC";
  else if (q.sort === "urgency")
    orderBy = ` ORDER BY CASE urgency WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END ASC, created_at DESC`;
  else orderBy = " ORDER BY created_at DESC, id DESC";

  return { where, params, orderBy };
}

// SLA fields the list/detail views show (target, deadline, status, aging).
function withSla(t, targets, now) {
  const e = enrichTicket(t, targets, now);
  return {
    ...toClientTicket(t),
    sla_status: e.sla_status,
    sla_deadline_at: e.sla_deadline_at,
    sla_target_minutes: e.sla_target_minutes,
    aging_minutes: e.aging_minutes,
    breach_minutes: e.breach_minutes,
  };
}

router.get("/api/tickets", requireAuth, async (req, res) => {
  try {
    const { where, params, orderBy } = await buildTicketListQuery(req.user, req.query);
    const rows = await db.pAll(
      `SELECT * FROM tickets WHERE ${where}${orderBy} LIMIT ${LIST_CAP + 1}`,
      params,
    );
    if (rows.length > LIST_CAP) {
      rows.length = LIST_CAP;
      res.setHeader("X-Result-Truncated", "1");
    }
    const targets = await getSlaTargets();
    const now = Date.now();
    res.json(rows.map((t) => withSla(t, targets, now)));
  } catch (e) {
    sendError(res, e, "Failed to fetch tickets");
  }
});

// ==========================================================================
// CSV export of the ticket list (same params + scope as the list).
// NOTE: must stay ABOVE "/api/tickets/:id" or "export" is read as an id.
// ==========================================================================
const EXPORT_COLUMNS = [
  ["Ticket Number", (t) => t.ticket_number || "#" + t.id],
  ["Title", "title"],
  ["Status", "status"],
  ["Urgency", "urgency"],
  ["Department", "department"],
  ["Category", "category"],
  ["Brand", "brand_code"],
  ["Outlet Code", "outlet_code"],
  ["Outlet Name", "outlet_name"],
  ["Region", "region"],
  ["Requestor", "customer_name"],
  ["Requestor Email", "customer_email"],
  ["Contact Person", "contact_person"],
  ["Contact Number", "contact_number"],
  ["Assignee", "assignee_name"],
  ["Source", "source"],
  ["Created At", "created_at"],
  ["Assigned At", "assigned_at"],
  ["First Response At", "first_response_at"],
  ["Started At", "started_at"],
  ["Scheduled At", "scheduled_at"],
  ["Scheduled End", "scheduled_end"],
  ["Resolved At", "resolved_at"],
  ["Closed At", "closed_at"],
  ["SLA Status", "sla_status"],
  ["SLA Deadline", "sla_deadline_at"],
  ["Age (hours)", (t) => (t.aging_minutes == null ? "" : Math.round((t.aging_minutes / 60) * 10) / 10)],
  ["Description", "description"],
  ["Resolution Note", "resolution_note"],
];

router.get("/api/tickets/export", requireAuth, async (req, res) => {
  try {
    const { where, params, orderBy } = await buildTicketListQuery(req.user, req.query);
    // Outlet name via correlated subquery, not a JOIN — outlets shares column
    // names with tickets and would make the scope clause ambiguous.
    const rows = await db.pAll(
      `SELECT tickets.*,
              (SELECT COALESCE(o.name, o.display_label, tickets.outlet_code)
                 FROM outlets o WHERE o.code = tickets.outlet_code) AS outlet_name
         FROM tickets WHERE ${where}${orderBy}`,
      params,
    );
    const targets = await getSlaTargets();
    const now = Date.now();
    const headers = EXPORT_COLUMNS.map(([h]) => h);
    const records = rows.map((raw) => {
      const t = withSla(raw, targets, now);
      const rec = {};
      for (const [h, src] of EXPORT_COLUMNS)
        rec[h] = typeof src === "function" ? src(t) : t[src];
      return rec;
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tickets_${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send("﻿" + toCsv(headers, records)); // BOM so Excel reads UTF-8
  } catch (e) {
    sendError(res, e, "Failed to export tickets");
  }
});

router.get("/api/tickets/:id", requireAuth, async (req, res) => {
  try {
    // Technicians may open anything inside their hard cap (PIC outlets, own
    // jobs, or the whole department when granted all-outlet access) — the same
    // set the "All allowed tickets" list shows.
    const ticket = await getVisibleTicket(req.user, req.params.id, { techFilter: "all" });
    if (!ticket)
      return res.status(404).json({ error: "Ticket not found or access denied" });
    if (ticket.outlet_code) {
      const outlet = await db.pGet(
        "SELECT name, display_label FROM outlets WHERE code = ?",
        [ticket.outlet_code],
      );
      ticket.outlet_name =
        (outlet && (outlet.name || outlet.display_label)) || ticket.outlet_code;
    } else {
      ticket.outlet_name = null;
    }
    const [comments, activity, attachments, assignments] = await Promise.all([
      db.pAll("SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC, id ASC", [ticket.id]),
      db.pAll("SELECT * FROM ticket_activity_logs WHERE ticket_id = ? ORDER BY created_at ASC, id ASC", [ticket.id]),
      db.pAll("SELECT id, ticket_id, comment_id, file_url, file_name, file_size, mime_type, phase, uploaded_by, created_at FROM attachments WHERE ticket_id = ? ORDER BY created_at ASC", [ticket.id]),
      db.pAll(
        `SELECT a.*, u.username AS technician_name, u.email AS technician_email, u.phone AS technician_phone, u.role AS technician_role
           FROM ticket_assignments a
           LEFT JOIN users u ON u.id = a.technician_id
          WHERE a.ticket_id = ? ORDER BY a.assigned_at DESC`,
        [ticket.id],
      ),
    ]);
    const activeAssignments = assignments.filter((a) => a.active === 1 || a.is_active === 1);
    const primaryTechnician = activeAssignments.find((a) => (a.role_type || "primary") === "primary") || null;
    const collaborators = activeAssignments.filter((a) => a.role_type === "collaborator");

    const targets = await getSlaTargets();
    res.json({
      ticket: withSla(ticket, targets, Date.now()),
      comments,
      activity,
      attachments,
      assignments,
      activeAssignments,
      primaryTechnician,
      collaborators,
    });
  } catch (e) {
    sendError(res, e, "Failed to fetch ticket");
  }
});

// ==========================================================================
// Dashboard — one scoped query, everything else is computed in memory so the
// numbers on every card come from the same snapshot.
// ==========================================================================
const pad2 = (n) => String(n).padStart(2, "0");
const localDay = (msVal) => {
  const d = new Date(msVal);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
// Schedules come from <input type="datetime-local"> (local wall-clock time,
// no zone) — take their date as written; zoned values are converted.
const scheduleDay = (v) => {
  const s = String(v);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const m = Date.parse(s);
    return Number.isNaN(m) ? null : localDay(m);
  }
  return s.slice(0, 10);
};
function countInto(map, key) {
  const k = key == null || key === "" ? null : key;
  map.set(k, (map.get(k) || 0) + 1);
}
const topN = (map, n, keyName) =>
  [...map.entries()]
    .filter(([k]) => k != null)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, c]) => ({ [keyName]: k, c }));

router.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const scope = await buildTicketScope(req.user);
    const rows = await db.pAll(
      `SELECT id, status, urgency, department, brand_code, outlet_code,
              COALESCE(region, 'Jakarta') AS region, category,
              assigned_technician_id, assignee_name, created_at, updated_at,
              first_response_at, assigned_at, started_at, resolved_at, closed_at, scheduled_at
         FROM tickets WHERE ${scope.clause}`,
      scope.params,
    );
    const targets = await getSlaTargets();
    const now = Date.now();
    const today = localDay(now);
    const weekStart = localDay(now - 6 * 86400000);
    const d = new Date(now);
    const monthStart = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;

    const byStatus = new Map();
    const byUrgency = new Map();
    const byDept = new Map();
    const byBrand = new Map();
    const byRegion = new Map();
    const byOutlet = new Map();
    const byTech = new Map();
    const byCat = new Map();
    const groups = Object.fromEntries(STATUS_GROUPS.map((g) => [g, 0]));
    const backlogUrgency = Object.fromEntries(URGENCIES.map((u) => [u, 0]));
    const aging = { lt1d: 0, d1to3: 0, d3to7: 0, gt7d: 0 };
    const trendDays = [];
    for (let i = 13; i >= 0; i--) trendDays.push(localDay(now - i * 86400000));
    const trend = new Map(trendDays.map((k) => [k, { day: k, created: 0, closed: 0 }]));

    let total = 0, backlog = 0, unassigned = 0, createdToday = 0, createdWeek = 0,
      createdMonth = 0, closedToday = 0, closedWeek = 0, criticalOpen = 0,
      slaMet = 0, slaBreached = 0, slaAtRisk = 0, overdueOpen = 0, scheduledToday = 0;
    const resHours = [];
    const frMins = [];
    const enriched = [];

    for (const t of rows) {
      total++;
      const e = enrichTicket(t, targets, now);
      enriched.push(e);
      countInto(byStatus, t.status);
      countInto(byUrgency, t.urgency);
      countInto(byDept, t.department);
      countInto(byBrand, t.brand_code);
      countInto(byRegion, t.region);
      countInto(byOutlet, t.outlet_code);
      if (t.assigned_technician_id) countInto(byTech, t.assignee_name);
      if (t.category) countInto(byCat, `${t.department || ""}||${t.category}`);
      groups[statusGroup(t.status)] += 1;

      const created = parseMs(t.created_at);
      const createdDay = created != null ? localDay(created) : null;
      if (createdDay === today) createdToday++;
      if (createdDay && createdDay >= weekStart) createdWeek++;
      if (createdDay && createdDay >= monthStart) createdMonth++;
      if (createdDay && trend.has(createdDay)) trend.get(createdDay).created++;

      const finished = parseMs(t.closed_at) ?? parseMs(t.resolved_at);
      const isDone = ["Resolved", "Closed"].includes(t.status);
      if (isDone && finished != null) {
        const fd = localDay(finished);
        if (fd === today) closedToday++;
        if (fd >= weekStart) closedWeek++;
        if (trend.has(fd)) trend.get(fd).closed++;
        if (created != null) resHours.push((finished - created) / 3600000);
      }
      if (e.first_response_mins != null) frMins.push(e.first_response_mins);

      const isBacklog = !TERMINAL_STATUSES.includes(t.status);
      if (isBacklog) {
        backlog++;
        if (!t.assigned_technician_id) unassigned++;
        if (backlogUrgency[t.urgency] != null) backlogUrgency[t.urgency]++;
        if (t.urgency === "Critical" && t.status !== "Resolved") criticalOpen++;
        const ageH = e.aging_minutes != null ? e.aging_minutes / 60 : 0;
        if (t.status !== "Resolved") {
          if (ageH < 24) aging.lt1d++;
          else if (ageH < 72) aging.d1to3++;
          else if (ageH < 168) aging.d3to7++;
          else aging.gt7d++;
        }
        if (e.sla_status === "Breached" && t.status !== "Resolved") overdueOpen++;
      }
      if (e.sla_status === "Met") slaMet++;
      else if (e.sla_status === "Breached") slaBreached++;
      else if (e.sla_status === "At Risk") slaAtRisk++;
      if (t.status === "On Scheduled" && t.scheduled_at && scheduleDay(t.scheduled_at) === today)
        scheduledToday++;
    }
    const exact = (s) => byStatus.get(s) || 0;
    const slaTotal = slaMet + slaBreached;
    const avgRes = avg(resHours, 1);
    const avgFr = avg(frMins, 0);

    // Technician workload (admins): one grouped query, idle technicians included.
    let workload = [];
    if (isAdmin(req.user)) {
      const roleFilter =
        req.user.role === "AdminIT"
          ? "u.role = 'TechnicianIT'"
          : req.user.role === "AdminME"
            ? "u.role = 'TechnicianME'"
            : "u.role IN ('TechnicianIT','TechnicianME')";
      workload = (
        await db.pAll(
          `SELECT u.username AS technician, u.role,
                  COUNT(t.id) AS open,
                  SUM(CASE WHEN t.urgency IN ('Critical','High') THEN 1 ELSE 0 END) AS urgent,
                  SUM(CASE WHEN t.status = 'On Progress' THEN 1 ELSE 0 END) AS in_progress
             FROM users u
             LEFT JOIN tickets t
               ON t.assigned_technician_id = u.id
              AND t.status IN (${OPEN_ASSIGNED_STATUSES.map(() => "?").join(",")})
            WHERE u.is_active = 1 AND ${roleFilter}
            GROUP BY u.id
            ORDER BY open DESC, u.username COLLATE NOCASE`,
          OPEN_ASSIGNED_STATUSES,
        )
      ).map((w) => ({
        technician: w.technician,
        department: deptForRole(w.role),
        open: w.open,
        urgent: w.urgent || 0,
        in_progress: w.in_progress || 0,
      }));
    }

    // Personal numbers for technicians: tickets they are on (PIC or collaborator).
    let mine = null;
    if (isTechnician(req.user)) {
      const teamIds = new Set(
        (
          await db.pAll(
            "SELECT ticket_id FROM ticket_assignments WHERE technician_id = ? AND (active = 1 OR is_active = 1)",
            [req.user.id],
          )
        ).map((r) => r.ticket_id),
      );
      const my = enriched.filter((t) => t.assigned_technician_id === req.user.id || teamIds.has(t.id));
      const myOpen = my.filter((t) => !["Resolved", "Closed", "Cancelled"].includes(t.status));
      mine = {
        open: myOpen.length,
        on_progress: myOpen.filter((t) => t.status === "On Progress").length,
        waiting: myOpen.filter((t) => WAITING_STATUSES.includes(t.status)).length,
        scheduled: myOpen.filter((t) => t.status === "On Scheduled").length,
        overdue: myOpen.filter((t) => t.sla_status === "Breached").length,
        done_week: my.filter((t) => {
          const f = parseMs(t.closed_at) ?? parseMs(t.resolved_at);
          return ["Resolved", "Closed"].includes(t.status) && f != null && localDay(f) >= weekStart;
        }).length,
        unassigned_pic: rows.filter((t) => !t.assigned_technician_id && !TERMINAL_STATUSES.includes(t.status)).length,
      };
    }

    // Outlet display names for the top-outlet list.
    const topOutlets = topN(byOutlet, 10, "outlet_code");
    if (topOutlets.length) {
      const names = await db.pAll(
        `SELECT code, COALESCE(display_label, name, code) AS label FROM outlets WHERE code IN (${topOutlets.map(() => "?").join(",")})`,
        topOutlets.map((o) => o.outlet_code),
      );
      const m = new Map(names.map((n) => [n.code, n.label]));
      for (const o of topOutlets) o.label = m.get(o.outlet_code) || o.outlet_code;
    }

    res.json({
      role: req.user.role,
      generated_at: new Date(now).toISOString(),
      totals: {
        total,
        new: groups.New,
        open: groups.Open,
        on_progress: exact("On Progress"),
        closed: groups.Closed,
        cancelled: groups.Cancelled,
        backlog,
        unassigned,
        assigned: exact("Assigned"),
        on_scheduled: exact("On Scheduled"),
        waiting_sparepart: exact("Waiting Sparepart"),
        waiting_vendor: exact("Waiting Vendor"),
        pending_outlet_response: exact("Pending Outlet Response"),
        escalated: exact("Escalated"),
        waiting: exact("Waiting Sparepart") + exact("Waiting Vendor"),
        resolved: exact("Resolved"),
        status_closed: exact("Closed"),
        created_today: createdToday,
        created_week: createdWeek,
        created_month: createdMonth,
        closed_today: closedToday,
        closed_week: closedWeek,
        critical_open: criticalOpen,
        overdue_open: overdueOpen,
        scheduled_today: scheduledToday,
      },
      avg_resolution_hours: avgRes,
      avg_first_response_mins: avgFr,
      sla: {
        met: slaMet,
        breached: slaBreached,
        at_risk: slaAtRisk,
        achievement: slaTotal ? Math.round((slaMet / slaTotal) * 1000) / 10 : null,
        targets,
      },
      aging,
      backlogUrgency,
      trend: [...trend.values()],
      byStatus: STATUSES.filter((s) => byStatus.has(s))
        .map((s) => ({ status: s, c: byStatus.get(s) }))
        .concat([...byStatus.entries()].filter(([s]) => s && !STATUSES.includes(s)).map(([s, c]) => ({ status: s, c }))),
      byStatusGroup: STATUS_GROUPS.map((g) => ({ status_group: g, c: groups[g] })),
      byUrgency: URGENCIES.map((u) => ({ urgency: u, c: byUrgency.get(u) || 0 })),
      byDept: topN(byDept, 10, "department"),
      byBrand: topN(byBrand, 20, "brand_code"),
      byRegion: topN(byRegion, 10, "region"),
      byOutlet: topOutlets,
      byTechnician: topN(byTech, 10, "assignee_name"),
      topCategories: topN(byCat, 8, "key").map(({ key, c }) => {
        const [department, category] = key.split("||");
        return { department: department || null, category, c };
      }),
      workload,
      mine,
    });
  } catch (e) {
    sendError(res, e, "Failed to build dashboard");
  }
});

// --- Recommendation --------------------------------------------------------
router.get(
  "/api/tickets/:id/recommend",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const ticket = await getVisibleTicket(req.user, req.params.id);
      if (!ticket)
        return res.status(404).json({ error: "Ticket not found or access denied" });
      if (!adminScopeForTicket(req.user, ticket))
        return res.status(403).json({ error: "Wrong department" });
      res.json(
        await recommendTechnicians(db, {
          department: ticket.department,
          categoryName: ticket.category,
        }),
      );
    } catch (e) {
      sendError(res, e, "Failed to compute recommendation");
    }
  },
);

// --- Comments (human) ------------------------------------------------------
router.post("/api/tickets/:id/comments", requireAuth, async (req, res) => {
  try {
    const ticket = await getVisibleTicket(req.user, req.params.id, { techFilter: "all" });
    if (!ticket)
      return res.status(404).json({ error: "Ticket not found or access denied" });
    if (req.user.role === "Leader")
      return res.status(403).json({ error: "View-only role cannot comment" });

    const body = req.body || {};
    const message = optStr(body.message, LIMITS.note * 2, "Message");
    const ids = normalizeIds(body.attachmentIds);
    if (!message && !ids.length)
      return res.status(400).json({ error: "A message or attachment is required" });

    // Only the caller's own, not-yet-linked uploads can be attached.
    let owned = [];
    if (ids.length) {
      owned = (
        await db.pAll(
          `SELECT id FROM attachments WHERE id IN (${ids.map(() => "?").join(",")})
             AND ticket_id IS NULL AND uploaded_by = ?`,
          [...ids, req.user.id],
        )
      ).map((r) => r.id);
      if (!owned.length && !message)
        return res.status(400).json({ error: "Those attachments are no longer available. Please upload them again." });
    }

    const r = await db.pRun(
      `INSERT INTO comments (ticket_id, author_name, author_role, author_user_id, message, is_system)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [ticket.id, req.user.username, req.user.role, req.user.id, message || "(attachment)"],
    );
    const commentId = r.lastID;

    if (owned.length) {
      const phase = ["before", "after", "general"].includes(body.phase) ? body.phase : "general";
      await db.pRun(
        `UPDATE attachments SET ticket_id = ?, comment_id = ?, phase = ?
          WHERE id IN (${owned.map(() => "?").join(",")}) AND ticket_id IS NULL`,
        [ticket.id, commentId, phase, ...owned],
      );
    }

    // First staff response marks first_response_at.
    const staffReply = req.user.role !== "Requestor" && !ticket.first_response_at;
    await db.pRun(
      `UPDATE tickets SET updated_at = CURRENT_TIMESTAMP${staffReply ? ", first_response_at = CURRENT_TIMESTAMP" : ""} WHERE id = ?`,
      [ticket.id],
    );
    await logActivity(
      ticket.id,
      req.user,
      "comment.added",
      message ? message.slice(0, 80) : `${owned.length} attachment(s)`,
    );

    res.status(201).json(await db.pGet("SELECT * FROM comments WHERE id = ?", [commentId]));
  } catch (e) {
    sendError(res, e, "Failed to add comment");
  }
});

/* Activity-log wording for a status change, in one plain sentence. */
const MARKED_AS_STATUSES = [...WAITING_STATUSES, "On Scheduled", "Escalated", "Resolved", "Cancelled"];
function statusChangeDetail(user, from, to, body = {}) {
  const who = actorLabel(user);
  const note = String(
    body.status_note ||
      (to === "Waiting Sparepart" && body.sparepart_note) ||
      (to === "Waiting Vendor" && body.vendor_note) ||
      (to === "Cancelled" && body.cancel_reason) ||
      (TERMINAL_STATUSES.includes(from) && (body.reopen_reason || body.reason)) ||
      "",
  )
    .trim()
    .slice(0, 300);
  const reopening = TERMINAL_STATUSES.includes(from) && !TERMINAL_STATUSES.includes(to);
  const sentence = reopening
    ? `${who} reopened the ticket (${from} → ${to}).`
    : MARKED_AS_STATUSES.includes(to)
      ? `${who} marked ticket as ${to}.`
      : `${who} changed status from ${from} to ${to}.`;
  const label = reopening ? "Reason" : to === "Cancelled" ? "Reason" : "Note";
  return note ? `${sentence} ${label}: ${note}` : sentence;
}

// Free-text operational fields and their validators.
const TEXT_FIELDS = {
  resolution_note: (v) => optStr(v, LIMITS.note, "Resolution note"),
  cancel_reason: (v) => optStr(v, LIMITS.note, "Cancel reason"),
  sparepart_note: (v) => optStr(v, LIMITS.short, "Sparepart note"),
  vendor_note: (v) => optStr(v, LIMITS.short, "Vendor note"),
  expected_part_date: (v) => optDateTime(v, "Expected date"),
  estimated_cost: (v) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = Number(String(v).replace(/[,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) throw new ValidationError("Estimated cost must be a positive number.");
    return n;
  },
  location_detail: (v) => optStr(v, LIMITS.short, "Location"),
  device_equipment: (v) => optStr(v, LIMITS.short, "Device"),
  business_impact: (v) => optStr(v, LIMITS.short, "Business impact"),
  contact_number: (v) => optPhone(v, "Contact number"),
  preferred_visit_time: (v) => optStr(v, LIMITS.short, "Preferred visit time"),
  scheduled_at: (v) => optDateTime(v, "Scheduled time"),
  scheduled_end: (v) => optDateTime(v, "Scheduled end"),
};

router.patch("/api/tickets/:id", requireAuth, async (req, res) => {
  try {
    const ticket = await getVisibleTicket(req.user, req.params.id, { techFilter: "all" });
    if (!ticket)
      return res.status(404).json({ error: "Ticket not found or access denied" });

    const b = req.body || {};
    const isDeptAdmin = adminScopeForTicket(req.user, ticket);

    /* A technician may act on a ticket when they are on its team (Primary/PIC
       or Collaborator) AND it is in their own department. */
    const teamRole = isTechnician(req.user) ? await teamRoleOf(ticket, req.user.id) : null;
    const isTeamTech = !!teamRole && technicianDeptMatches(req.user, ticket);
    if (!isDeptAdmin && !isTeamTech) {
      return res.status(403).json({
        error: isTechnician(req.user)
          ? "You are not assigned to this ticket."
          : "You do not have permission to edit this ticket",
      });
    }

    // Column → value; a Map so a column can never appear twice in the UPDATE.
    const changes = new Map();
    const activities = [];
    const nowIso = new Date().toISOString();

    // Validate free-text fields up-front (400 before anything is written).
    const text = {};
    for (const [f, check] of Object.entries(TEXT_FIELDS)) {
      if (b[f] !== undefined) text[f] = check(b[f]);
    }

    // Status change (with guards + timestamps)
    if (b.status && b.status !== ticket.status) {
      if (isTeamTech && !isDeptAdmin) {
        if (TERMINAL_STATUSES.includes(ticket.status))
          return res.status(403).json({
            error: `This ticket is already ${ticket.status === "Closed" ? "closed" : "cancelled"}.`,
          });
        if (!TECHNICIAN_STATUSES.includes(b.status))
          return res.status(403).json({ error: "Technicians cannot set that status" });
      }
      if (b.status === "Closed" && !canClose(req.user, ticket, { isTeamMember: isTeamTech }))
        return res.status(403).json({ error: "You are not allowed to close this ticket" });
      const err = validateTransition(
        ticket,
        b.status,
        { ...b, resolution_note: text.resolution_note ?? b.resolution_note },
        req.user,
        { isTeamMember: isTeamTech },
      );
      if (err) return res.status(400).json({ error: err });

      changes.set("status", b.status);
      if (b.status === "On Progress" && !ticket.started_at) changes.set("started_at", nowIso);
      if (b.status === "Resolved" && !ticket.resolved_at) changes.set("resolved_at", nowIso);
      if (b.status === "Closed") {
        if (!ticket.closed_at) changes.set("closed_at", nowIso);
        if (!ticket.resolved_at) changes.set("resolved_at", nowIso);
      }
      // Reopened / sent back to work: the old finish timestamps no longer hold,
      // otherwise SLA and resolution time would be measured to a stale point.
      if (!["Resolved", "Closed", "Cancelled"].includes(b.status)) {
        if (ticket.closed_at) changes.set("closed_at", null);
        if (ticket.resolved_at) changes.set("resolved_at", null);
      }
      activities.push(["status.changed", statusChangeDetail(req.user, ticket.status, b.status, b)]);
    }

    if (b.urgency && URGENCIES.includes(b.urgency) && b.urgency !== ticket.urgency) {
      if (!isDeptAdmin)
        return res.status(403).json({ error: "Only admins can change urgency" });
      changes.set("urgency", b.urgency);
      activities.push(["urgency.changed", `${ticket.urgency} → ${b.urgency}`]);
    }

    // Department / category re-routing
    const newDept =
      b.department && DEPARTMENTS.includes(b.department) && b.department !== ticket.department
        ? b.department
        : null;
    if (newDept) {
      if (!isDeptAdmin)
        return res.status(403).json({ error: "Only admins can re-route department" });
      changes.set("department", newDept);
      activities.push(["department.changed", `${ticket.department} → ${newDept} (escalation)`]);
    }
    const dept = newDept || ticket.department;
    const wantedCategory = b.category ? String(b.category) : newDept ? ticket.category : null;
    if (wantedCategory) {
      const ok = await db.pGet(
        "SELECT 1 FROM categories WHERE department_code = ? AND name = ?",
        [dept, wantedCategory],
      );
      if (!ok)
        return res.status(400).json({
          error: newDept && !b.category
            ? `Pick a ${dept} category when moving this ticket to ${dept}.`
            : "Category does not belong to the ticket department",
        });
      if (wantedCategory !== ticket.category) {
        if (!isDeptAdmin && !isTeamTech)
          return res.status(403).json({ error: "You cannot change the category" });
        changes.set("category", wantedCategory);
        activities.push(["category.changed", `${ticket.category} → ${wantedCategory}`]);
      }
    }
    if (b.outlet_code && b.outlet_code !== ticket.outlet_code) {
      if (!isDeptAdmin)
        return res.status(403).json({ error: "Only admins can change outlet" });
      const o = await db.pGet("SELECT brand_code, region FROM outlets WHERE code = ?", [b.outlet_code]);
      if (!o) return res.status(400).json({ error: "Unknown outlet" });
      changes.set("outlet_code", b.outlet_code);
      changes.set("brand_code", o.brand_code);
      changes.set("region", o.region || "Jakarta");
      activities.push(["outlet.changed", `${ticket.outlet_code} → ${b.outlet_code}`]);
    }

    for (const [f, v] of Object.entries(text)) {
      if (v !== (ticket[f] ?? null) && !changes.has(f)) changes.set(f, v);
    }
    const se = changes.has("scheduled_end") ? changes.get("scheduled_end") : ticket.scheduled_end;
    const sa = changes.has("scheduled_at") ? changes.get("scheduled_at") : ticket.scheduled_at;
    if (sa && se && Date.parse(String(se).replace(" ", "T")) < Date.parse(String(sa).replace(" ", "T")))
      return res.status(400).json({ error: "Scheduled end must be after the scheduled start." });

    if (!changes.size)
      return res.status(400).json({ error: "No changes provided" });
    changes.set("updated_at", nowIso);
    if (!ticket.first_response_at && (isDeptAdmin || isTeamTech))
      changes.set("first_response_at", nowIso);

    const cols = [...changes.keys()];
    await db.pRun(
      `UPDATE tickets SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      [...cols.map((c) => changes.get(c)), ticket.id],
    );
    for (const [action, detail] of activities)
      await logActivity(ticket.id, req.user, action, detail);

    const updated = await db.pGet("SELECT * FROM tickets WHERE id = ?", [ticket.id]);
    res.json(withSla(updated, await getSlaTargets(), Date.now()));
  } catch (e) {
    sendError(res, e, "Failed to update ticket");
  }
});

// --- Assign / reassign / multi-technician assignment ------------------------
router.post(
  "/api/tickets/:id/assign",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const ticket = await getVisibleTicket(req.user, req.params.id);
      if (!ticket)
        return res.status(404).json({ error: "Ticket not found or access denied" });
      if (!adminScopeForTicket(req.user, ticket))
        return res.status(403).json({ error: "Wrong department" });

      const { technician_id, action, role_type, reason, note, override } = req.body || {};
      const techId = Number.parseInt(technician_id, 10);
      if (!Number.isInteger(techId))
        return res.status(400).json({ error: "technician_id is required" });
      if (action && !["remove", "set_primary", "add_collaborator"].includes(action))
        return res.status(400).json({ error: "Unknown action" });
      if (role_type && !["primary", "collaborator"].includes(role_type))
        return res.status(400).json({ error: "role_type must be primary or collaborator" });
      if (action !== "remove" && TERMINAL_STATUSES.includes(ticket.status))
        return res.status(400).json({ error: "Reopen the ticket before changing its team." });
      const why = optStr(note || reason, LIMITS.short, "Note");

      // "remove" may target anyone already on the team regardless of department.
      const loaded = await loadAssignableTechnician(techId, ticket, {
        override: !!override || action === "remove",
        allowInactive: action === "remove",
      });
      if (loaded.error)
        return res.status(loaded.status).json({ error: loaded.error });
      const tech = loaded.tech;

      const team = await getTeam(ticket.id);
      const targetRole =
        role_type ||
        (action === "add_collaborator" ? "collaborator" : action === "set_primary" ? "primary" : null) ||
        (!team.primary ? "primary" : "collaborator");

      if (action === "remove") {
        const onTeam = team.active.some((a) => a.technician_id === tech.id);
        if (!onTeam)
          return res.status(400).json({ error: "This technician is not assigned to this ticket." });
        await removeAssignment(ticket, tech, req.user);
      } else if (targetRole === "primary") {
        if (team.primary && team.primary.technician_id === tech.id)
          return res.status(400).json({ error: "This technician is already the Primary Technician." });
        await setPrimary(ticket, tech, req.user, why);
      } else {
        if (team.primary && team.primary.technician_id === tech.id)
          return res.status(400).json({ error: "This technician is already the Primary Technician." });
        if (team.collaborators.some((c) => c.technician_id === tech.id))
          return res.status(400).json({ error: "This technician is already a Collaborator." });
        const added = await addCollaborator(ticket, tech, req.user, why, "admin");
        if (!added.added)
          return res.status(400).json({ error: "This technician is already assigned to this ticket." });
      }

      if (action !== "remove") {
        notify("ticket.assigned", {
          ticketId: ticket.id,
          recipients: [{ name: tech.username, email: tech.email, phone: tech.phone }],
          message: `You were assigned as ${targetRole} for ticket ${ticket.ticket_number}`,
          channels: ["in_app"],
        });
      }

      res.json(toClientTicket(await db.pGet("SELECT * FROM tickets WHERE id = ?", [ticket.id])));
    } catch (e) {
      sendError(res, e, "Failed to update technician assignment");
    }
  },
);

/* --------------------------------------------------------------------------
   Collaborator invitations (technician-side). Open to a dept admin OR a
   technician already on the ticket's team (Primary or Collaborator).
   -------------------------------------------------------------------------- */
async function loadTicketForCollaboration(req) {
  const ticket = await getVisibleTicket(req.user, req.params.id, { techFilter: "all" });
  if (!ticket) return { error: "Ticket not found or access denied", status: 404 };

  const isTeamAdmin = adminScopeForTicket(req.user, ticket);
  if (isTeamAdmin) return { ticket, isTeamAdmin };

  if (!isTechnician(req.user))
    return { error: "Only assigned technicians can invite collaborators.", status: 403 };
  if (deptForRole(req.user.role) !== ticket.department)
    return { error: "You can only invite technicians from the same department.", status: 403 };
  if (!(await teamRoleOf(ticket, req.user.id)))
    return { error: "Only assigned technicians can invite collaborators.", status: 403 };
  return { ticket, isTeamAdmin: false };
}

router.get("/api/tickets/:id/assignable-technicians", requireAuth, async (req, res) => {
  try {
    const loaded = await loadTicketForCollaboration(req);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const { ticket } = loaded;

    const { primary, collaborators } = await getTeam(ticket.id);
    const ranked = await recommendTechnicians(db, {
      department: ticket.department,
      categoryName: ticket.category,
    });
    res.json({
      ticket: {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        title: ticket.title,
        department: ticket.department,
        category: ticket.category,
        outlet_code: ticket.outlet_code,
        outlet_name: ticket.outlet_name || ticket.outlet_code,
        status: ticket.status,
      },
      primary: primary
        ? { technician_id: primary.technician_id, technician_name: primary.technician_name }
        : null,
      collaborators: collaborators.map((c) => ({
        technician_id: c.technician_id,
        technician_name: c.technician_name,
      })),
      candidates: ranked.map((r) => ({
        id: r.id,
        username: r.username,
        department: r.department || ticket.department,
        workload: r.workload,
        availability: r.availability,
        available: r.available,
        is_self: r.id === req.user.id,
        is_primary: !!primary && primary.technician_id === r.id,
        is_collaborator: collaborators.some((c) => c.technician_id === r.id),
      })),
    });
  } catch (e) {
    sendError(res, e, "Failed to list technicians");
  }
});

router.post("/api/tickets/:id/collaborators/invite", requireAuth, async (req, res) => {
  try {
    const loaded = await loadTicketForCollaboration(req);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const { ticket, isTeamAdmin } = loaded;

    if (TERMINAL_STATUSES.includes(ticket.status))
      return res.status(400).json({ error: "This ticket is already closed or cancelled." });

    const { technician_id } = req.body || {};
    const techId = Number.parseInt(technician_id, 10);
    if (!Number.isInteger(techId))
      return res.status(400).json({ error: "technician_id is required" });
    if (techId === req.user.id)
      return res.status(400).json({ error: "You are already assigned to this ticket." });
    const note = optStr((req.body || {}).note, LIMITS.short, "Note");

    const tech = await db.pGet(
      "SELECT id, username, email, phone, role, is_active FROM users WHERE id = ?",
      [techId],
    );
    if (!tech || !isTechnician({ role: tech.role }))
      return res.status(400).json({ error: "Not a valid technician" });
    if (tech.is_active === 0)
      return res.status(400).json({ error: "Technician is inactive" });
    if (deptForRole(tech.role) !== ticket.department)
      return res.status(400).json({ error: "You can only invite technicians from the same department." });

    const { primary, collaborators } = await getTeam(ticket.id);
    if (primary && primary.technician_id === tech.id)
      return res.status(400).json({ error: "This technician is already the Primary Technician." });
    if (collaborators.some((c) => c.technician_id === tech.id))
      return res.status(400).json({ error: "This technician is already a Collaborator." });

    const added = await addCollaborator(ticket, tech, req.user, note, isTeamAdmin ? "admin" : "invite");
    if (!added.added)
      return res.status(400).json({ error: "This technician is already assigned to this ticket." });

    notify("ticket.assigned", {
      ticketId: ticket.id,
      recipients: [{ name: tech.username, email: tech.email, phone: tech.phone }],
      message: `${req.user.username} invited you as Collaborator on ticket ${ticket.ticket_number}`,
      channels: ["in_app"],
    });

    const team = await getTeam(ticket.id);
    res.status(201).json({
      success: true,
      collaborator: { technician_id: tech.id, technician_name: tech.username },
      primaryTechnician: team.primary,
      collaborators: team.collaborators,
      status: ticket.status,
    });
  } catch (e) {
    sendError(res, e, "Failed to invite collaborator");
  }
});

// --- Self-assignment (technicians) -----------------------------------------
router.post("/api/tickets/:id/assign-to-me", requireAuth, async (req, res) => {
  try {
    if (!isTechnician(req.user))
      return res.status(403).json({ error: "Only technicians can self-assign tickets" });

    const ticket = await getVisibleTicket(req.user, req.params.id, { techFilter: "all" });
    if (!ticket)
      return res.status(404).json({ error: "Ticket not found or outside your allowed scope" });
    if (ticket.department !== deptForRole(req.user.role))
      return res.status(403).json({ error: "You can only take tickets in your own department" });
    if (TERMINAL_STATUSES.includes(ticket.status))
      return res.status(400).json({ error: "This ticket is already closed or cancelled" });

    const existing = await teamRoleOf(ticket, req.user.id);
    if (existing)
      return res.status(400).json({ error: `You are already assigned as ${existing} to this ticket.` });

    // Become Primary only if nobody holds it — decided inside the INSERT so two
    // technicians tapping at the same moment cannot both become Primary.
    const me = { id: req.user.id, username: req.user.username };
    const asPrimary = await db.pRun(
      `INSERT INTO ticket_assignments (ticket_id, technician_id, assigned_by, reason, role_type, active, is_active)
       SELECT ?, ?, ?, 'self-assignment', 'primary', 1, 1
        WHERE NOT EXISTS (
          SELECT 1 FROM ticket_assignments
           WHERE ticket_id = ? AND (active = 1 OR is_active = 1)
             AND (role_type = 'primary' OR role_type IS NULL OR technician_id = ?))
          AND (SELECT assigned_technician_id FROM tickets WHERE id = ?) IS NULL`,
      [ticket.id, me.id, me.id, ticket.id, me.id, ticket.id],
    );
    let roleType;
    if (asPrimary.changes) {
      roleType = "primary";
      await db.pRun(
        `UPDATE tickets SET assigned_technician_id = ?, assignee_name = ?,
           assigned_at = COALESCE(assigned_at, CURRENT_TIMESTAMP),
           first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [me.id, me.username, ticket.id],
      );
      await logActivity(ticket.id, req.user, "ticket.assigned", `${me.username} took this ticket as Primary Technician / PIC.`);
    } else {
      const added = await addCollaborator(ticket, me, req.user, "self-assignment", "self");
      if (!added.added)
        return res.status(400).json({ error: "You are already assigned to this ticket." });
      roleType = "collaborator";
    }

    const updated = await db.pGet("SELECT * FROM tickets WHERE id = ?", [ticket.id]);
    res.json({ ...toClientTicket(updated), self_role: roleType });
  } catch (e) {
    sendError(res, e, "Failed to self-assign ticket");
  }
});

// --- Create ticket ---------------------------------------------------------
// Double-submit guard (very short window), pruned so it never grows unbounded.
const recentCreates = new Map();
const DUP_WINDOW_MS = 8000;
const pruneCreates = setInterval(() => {
  const cutoff = Date.now() - DUP_WINDOW_MS;
  for (const [k, t] of recentCreates) if (t < cutoff) recentCreates.delete(k);
}, 60 * 1000);
pruneCreates.unref();

router.post("/api/tickets", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "Leader")
      return res.status(403).json({ error: "View-only role cannot create tickets" });
    const b = req.body || {};
    const department = String(b.department || "").toUpperCase();
    if (!DEPARTMENTS.includes(department))
      return res.status(400).json({ error: "Department must be IT or ME" });
    if (!b.outlet_code) return res.status(400).json({ error: "Outlet is required" });
    if (!b.category) return res.status(400).json({ error: "Category is required" });

    const description = optStr(b.description, LIMITS.description, "Description");
    const titleIn = optStr(b.title, LIMITS.title, "Subject");
    if (!description && !titleIn)
      return res.status(400).json({ error: "A short issue description is required" });

    const cat = await db.pGet(
      "SELECT 1 FROM categories WHERE department_code = ? AND name = ? AND active = 1",
      [department, String(b.category)],
    );
    if (!cat)
      return res.status(400).json({ error: `Category "${String(b.category).slice(0, 60)}" is not available for ${department}` });

    const outlet = await db.pGet(
      "SELECT code, brand_code, region FROM outlets WHERE code = ? AND active = 1",
      [String(b.outlet_code)],
    );
    if (!outlet) return res.status(400).json({ error: "Unknown or inactive outlet" });

    const urgency = URGENCIES.includes(b.urgency) ? b.urgency : "Medium";
    const reportMode = b.report_mode === "detailed" ? "detailed" : "quick";
    const requestorName =
      optStr(b.requestor_name || b.customer_name, LIMITS.name, "Requestor name") || req.user.username;
    // Only admins may file on behalf of another email; everyone else files as themselves.
    let requestorEmail = req.user.email;
    if (isAdmin(req.user) && b.customer_email) {
      const ce = optStr(b.customer_email, 254, "Requestor email");
      if (ce && !EMAIL_RE.test(ce)) return res.status(400).json({ error: "Requestor email is not valid" });
      if (ce) requestorEmail = ce.toLowerCase();
    }
    const contactNumber = optPhone(b.contact_number, "Contact number");
    const fields = {
      contact_person: optStr(b.contact_person, LIMITS.name, "Contact person") || requestorName,
      location_detail: optStr(b.location_detail, LIMITS.short, "Location"),
      device_equipment: optStr(b.device_equipment, LIMITS.short, "Device"),
      business_impact: optStr(b.business_impact, LIMITS.short, "Business impact"),
      preferred_visit_time: optStr(b.preferred_visit_time, LIMITS.short, "Preferred visit time"),
      occurrence_at: optDateTime(b.occurrence_at, "When it happened"),
      scheduled_at: optDateTime(b.scheduled_at, "Scheduled start"),
      scheduled_end: optDateTime(b.scheduled_end, "Scheduled end"),
    };
    if (fields.scheduled_at && fields.scheduled_end &&
        Date.parse(fields.scheduled_end) < Date.parse(fields.scheduled_at))
      return res.status(400).json({ error: "Scheduled end must be after the scheduled start." });

    const fp = crypto
      .createHash("sha1")
      .update(`${req.user.id}|${outlet.code}|${b.category}|${description || titleIn || ""}`)
      .digest("hex");
    const last = recentCreates.get(fp);
    if (last && Date.now() - last < DUP_WINDOW_MS)
      return res.status(409).json({ error: "Looks like a duplicate submission. Please wait a moment." });
    recentCreates.set(fp, Date.now());

    const title = titleIn || (description ? description.slice(0, 80) : `${b.category} issue`);
    const { number: ticketNumber, result: r } = await insertWithNumber(department, (number) =>
      db.pRun(
        `INSERT INTO tickets
          (ticket_number, title, description, department, category, outlet_code, brand_code, region,
           status, urgency, report_mode, requestor_user_id, customer_name, customer_email,
           contact_person, contact_number, location_detail, device_equipment, business_impact,
           preferred_visit_time, occurrence_at, scheduled_at, scheduled_end, assignee_name, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unassigned', 'authenticated')`,
        [
          number, title, description || title, department, String(b.category), outlet.code,
          outlet.brand_code || null, outlet.region || "Jakarta", urgency, reportMode, req.user.id,
          requestorName, requestorEmail, fields.contact_person, contactNumber,
          fields.location_detail, fields.device_equipment, fields.business_impact,
          fields.preferred_visit_time, fields.occurrence_at, fields.scheduled_at, fields.scheduled_end,
        ],
      ),
    );
    const ticketId = r.lastID;

    // Link the caller's own pre-uploaded attachments.
    const ids = normalizeIds(b.attachmentIds);
    if (ids.length) {
      await db.pRun(
        `UPDATE attachments SET ticket_id = ?
          WHERE id IN (${ids.map(() => "?").join(",")}) AND ticket_id IS NULL AND uploaded_by = ?`,
        [ticketId, ...ids, req.user.id],
      );
    }

    await logActivity(
      ticketId,
      req.user,
      "ticket.created",
      `${ticketNumber} • ${department}/${b.category} • ${outlet.code}`,
    );

    const admins = await db.pAll(
      `SELECT username, email, phone FROM users WHERE is_active = 1 AND role IN ('SuperAdmin', ?)`,
      [department === "IT" ? "AdminIT" : "AdminME"],
    );
    notify("ticket.created", {
      ticketId,
      recipients: admins,
      message: `New ${department} ticket ${ticketNumber}`,
      channels: ["in_app"],
    });

    const displayTicketNumber = `${ticketNumber} - ${outlet.code}`;
    const ticketUrl = `${APP_URL}/tickets/${ticketId}`;
    if (contactNumber) {
      notify("ticket.created", {
        ticketId,
        ticketNumber: displayTicketNumber,
        recipients: [{ name: fields.contact_person, phone: contactNumber }],
        message: `Tiket pelaporan anda telah berhasil dibuat!\n\n• *Nomor Tiket*: ${displayTicketNumber}\n👉 ${ticketUrl}`,
        channels: ["whatsapp"],
      });
    }
    alertNewTicket({
      ticketId,
      department,
      displayNumber: displayTicketNumber,
      message:
        `🚨 *TIKET BARU TERBUAT* 🚨\n• *Nomor Tiket*: ${displayTicketNumber}\n👉 ${ticketUrl}` +
        `\n• *Departemen*: ${department}\n• *Kategori*: ${b.category}\n• *Outlet*: ${outlet.code}` +
        `\n• *Urgensi*: ${urgency}` +
        `\n• *Pelapor*: ${fields.contact_person}${contactNumber ? " (" + contactNumber + ")" : ""}` +
        `\n• *Deskripsi*: ${(description || title).slice(0, 500)}`,
    }).catch((e) => console.error("[notify] alert failed:", e.message));

    const ticket = await db.pGet("SELECT * FROM tickets WHERE id = ?", [ticketId]);
    res.status(201).json(toClientTicket(ticket));
  } catch (e) {
    sendError(res, e, "Failed to create ticket");
  }
});

module.exports = router;
