/* ==========================================================================
   Routes — Tickets (READ-ONLY subset)
   Phase 2.4B1: only read-only ticket endpoints live here. Mutation routes
   (POST/PATCH/comments/assign/recommend) remain inline in app.js and will be
   moved in a later, separately-approved phase.

   Verbatim move from app.js — URLs, middleware, RBAC, scoping and response
   shapes unchanged. Mounted at "/" so full "/api/..." paths are preserved.

   Endpoints:
     GET /api/tickets         (scoped list)
     GET /api/tickets/export  (scoped list as CSV — same filters as the list)
     GET /api/tickets/:id     (scoped detail bundle)
     GET /api/dashboard       (scoped ticket summary)
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
const { getVisibleTicket } = require("../services/tickets.service");
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
const { nextTicketNumber } = require("../utils/ticketNumber");
const { logActivity } = require("../services/auditLog.service");
const {
  DEPARTMENTS,
  URGENCIES,
  ADMIN_ROLES,
  SLA_TARGET_MINUTES,
  STATUS_GROUPS,
  statusesInGroup,
  TECHNICIAN_STATUSES,
  WAITING_STATUSES,
} = require("../config/constants");
const {
  recommendTechnicians,
  OPEN_ASSIGNED_STATUSES,
} = require("../../services/recommend");
const { notify } = require("../../services/notifications");
const { toCsv } = require("../utils/csv");

const router = express.Router();

// --------------------------------------------------------------------------
// Shared list query — the scope clause, filters and ordering used by BOTH the
// ticket list and the CSV export, so an export can never widen (or narrow)
// what the list on screen shows.
// Returns { where, params, orderBy }. The scope clause references the tickets
// table by bare column names (and `tickets.id`), so callers must keep the table
// unaliased and must not JOIN tables that share column names with it.
// --------------------------------------------------------------------------
async function buildTicketListQuery(user, query) {
  const {
    status,
    priority,
    urgency,
    department,
    brand,
    outlet,
    region,
    category,
    search,
    assigned,
    scope: techFilter,
    sort,
    status_group: statusGroupFilter,
  } = query;
  const scope = await buildTicketScope(user, { techFilter });
  let where = scope.clause;
  const params = [...scope.params];
  const add = (frag, ...vals) => {
    where += frag;
    params.push(...vals);
  };

  if (status) add(" AND status = ?", status);
  // Optional grouped filter (dashboard core-card drill-down). Expands to the
  // real statuses in that group — the stored status is never rewritten.
  if (statusGroupFilter && STATUS_GROUPS.includes(statusGroupFilter)) {
    const members = statusesInGroup(statusGroupFilter);
    add(` AND status IN (${members.map(() => "?").join(",")})`, ...members);
  }
  if (urgency) add(" AND urgency = ?", urgency);
  if (priority) add(" AND urgency = ?", priority); // legacy alias
  if (department && DEPARTMENTS.includes(department))
    add(" AND department = ?", department);
  if (brand) add(" AND brand_code = ?", brand);
  if (outlet) add(" AND outlet_code = ?", outlet);
  if (region) add(" AND region = ?", region);
  if (category) add(" AND category = ?", category);
  // Unassigned filter (dashboard "Unassigned" card drill-down). Matches the
  // dashboard count: no primary technician and not Closed/Cancelled.
  if (assigned === "no" || assigned === "unassigned")
    add(" AND assigned_technician_id IS NULL AND status NOT IN ('Closed','Cancelled')");
  if (search) {
    add(
      " AND (title LIKE ? OR description LIKE ? OR ticket_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)",
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
    );
  }

  // Default sort is newest-first (created_at DESC). Urgency ordering is only
  // applied when explicitly requested — it never controls the default.
  let orderBy;
  if (sort === "created_asc") orderBy = " ORDER BY created_at ASC";
  else if (sort === "urgency")
    orderBy = ` ORDER BY CASE urgency WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END ASC, created_at DESC`;
  else orderBy = " ORDER BY created_at DESC"; // default (also 'created_desc')

  return { where, params, orderBy };
}

router.get("/api/tickets", requireAuth, async (req, res) => {
  try {
    const { where, params, orderBy } = await buildTicketListQuery(
      req.user,
      req.query,
    );
    res.json(
      await db.pAll(`SELECT * FROM tickets WHERE ${where}${orderBy}`, params),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// ==========================================================================
// CSV export of the ticket list
// Accepts exactly the same query params as GET /api/tickets and is scoped by
// the same buildTicketScope clause — a user can only ever export the rows they
// can already see in the list.
// NOTE: must stay ABOVE "/api/tickets/:id" or "export" is read as an id.
// ==========================================================================
// [csv header, ticket field | (ticket) => value]
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
  ["Age (hours)", (t) => ageHours(t)],
  ["Description", "description"],
  ["Resolution Note", "resolution_note"],
];

// Stored timestamps are UTC "YYYY-MM-DD HH:MM:SS" — normalise before parsing.
const parseTs = (s) => {
  if (!s) return null;
  const d = new Date(/[TZ]/.test(s) ? s : String(s).replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
};
// Open tickets age until now; finished ones stop at closed/resolved.
function ageHours(t) {
  const from = parseTs(t.created_at);
  if (!from) return "";
  const to = parseTs(t.closed_at) || parseTs(t.resolved_at) || new Date();
  return Math.max(0, Math.round(((to - from) / 3600000) * 10) / 10);
}

router.get("/api/tickets/export", requireAuth, async (req, res) => {
  try {
    const { where, params, orderBy } = await buildTicketListQuery(
      req.user,
      req.query,
    );
    // Outlet name via correlated subquery, not a JOIN — outlets shares column
    // names (brand_code, region) with tickets and would make the scope clause
    // ambiguous.
    const rows = await db.pAll(
      `SELECT tickets.*,
              (SELECT COALESCE(o.name, o.display_label, tickets.outlet_code)
                 FROM outlets o WHERE o.code = tickets.outlet_code) AS outlet_name
         FROM tickets WHERE ${where}${orderBy}`,
      params,
    );
    const headers = EXPORT_COLUMNS.map(([h]) => h);
    const records = rows.map((t) => {
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
    console.error(e);
    res.status(500).json({ error: "Failed to export tickets" });
  }
});

router.get("/api/tickets/:id", requireAuth, async (req, res) => {
  try {
    const ticket = await getVisibleTicket(req.user, req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ error: "Ticket not found or access denied" });
    // Attach a human-friendly outlet name (name → display_label → code) so the
    // detail header can show "[NUMBER] - [Outlet Name]" without an extra call.
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
    const comments = await db.pAll(
      "SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC",
      [ticket.id],
    );
    const activity = await db.pAll(
      "SELECT * FROM ticket_activity_logs WHERE ticket_id = ? ORDER BY created_at ASC",
      [ticket.id],
    );
    const attachments = await db.pAll(
      "SELECT * FROM attachments WHERE ticket_id = ?",
      [ticket.id],
    );
    const assignments = await db.pAll(
      `SELECT a.*, u.username AS technician_name, u.email AS technician_email, u.phone AS technician_phone, u.role AS technician_role
       FROM ticket_assignments a
       LEFT JOIN users u ON u.id = a.technician_id WHERE a.ticket_id = ? ORDER BY a.assigned_at DESC`,
      [ticket.id],
    );
    const activeAssignments = assignments.filter((a) => a.active === 1 || a.is_active === 1);
    const primaryTechnician = activeAssignments.find((a) => (a.role_type || 'primary') === 'primary') || null;
    const collaborators = activeAssignments.filter((a) => a.role_type === 'collaborator');

    res.json({ ticket, comments, activity, attachments, assignments, activeAssignments, primaryTechnician, collaborators });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

// ==========================================================================
// Dashboard (role-aware aggregates)
// ==========================================================================
router.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const scope = await buildTicketScope(req.user);
    const W = scope.clause;
    const P = scope.params;
    const one = async (sql, extra = []) =>
      (
        await db.pGet(`SELECT COUNT(*) c FROM tickets WHERE ${W}${sql}`, [
          ...P,
          ...extra,
        ])
      ).c;

    const byStatus = await db.pAll(
      `SELECT status, COUNT(*) c FROM tickets WHERE ${W} GROUP BY status`,
      P,
    );
    const byUrgency = await db.pAll(
      `SELECT urgency, COUNT(*) c FROM tickets WHERE ${W} GROUP BY urgency`,
      P,
    );
    const byDept = await db.pAll(
      `SELECT department, COUNT(*) c FROM tickets WHERE ${W} GROUP BY department`,
      P,
    );
    const byBrand = await db.pAll(
      `SELECT brand_code, COUNT(*) c FROM tickets WHERE ${W} GROUP BY brand_code`,
      P,
    );
    const byRegion = await db.pAll(
      `SELECT COALESCE(region,'Jakarta') region, COUNT(*) c FROM tickets WHERE ${W} GROUP BY COALESCE(region,'Jakarta')`,
      P,
    );
    const byOutlet = await db.pAll(
      `SELECT outlet_code, COUNT(*) c FROM tickets WHERE ${W} GROUP BY outlet_code ORDER BY c DESC LIMIT 10`,
      P,
    );
    const byTechnician = await db.pAll(
      `SELECT assignee_name, COUNT(*) c FROM tickets
       WHERE ${W} AND assigned_technician_id IS NOT NULL
       GROUP BY assignee_name ORDER BY c DESC LIMIT 10`,
      P,
    );
    const topCategories = await db.pAll(
      `SELECT department, category, COUNT(*) c FROM tickets WHERE ${W} GROUP BY department, category ORDER BY c DESC LIMIT 8`,
      P,
    );

    // Grouped counts for the core dashboard cards. Grouping is read-side only:
    // an "Open" card counts Open/Assigned/On Scheduled/Waiting */Pending/
    // Escalated tickets without touching their stored status.
    const groupCount = (g) => {
      const members = statusesInGroup(g);
      if (!members.length) return 0;
      return one(
        ` AND status IN (${members.map(() => "?").join(",")})`,
        members,
      );
    };
    const byStatusGroup = [];
    for (const g of STATUS_GROUPS) {
      byStatusGroup.push({ status_group: g, c: await groupCount(g) });
    }
    const groupTotals = Object.fromEntries(
      byStatusGroup.map((r) => [r.status_group, r.c]),
    );

    const total = await one("");
    const backlog = await one(` AND status NOT IN ('Closed','Cancelled')`);
    const newCount = groupTotals["New"];
    const unassigned = await one(
      ` AND assigned_technician_id IS NULL AND status NOT IN ('Closed','Cancelled')`,
    );
    const assigned = await one(` AND status = 'Assigned'`);
    const onScheduled = await one(` AND status = 'On Scheduled'`);
    const waitingSparepart = await one(` AND status = 'Waiting Sparepart'`);
    const waitingVendor = await one(` AND status = 'Waiting Vendor'`);
    const pendingOutlet = await one(` AND status = 'Pending Outlet Response'`);
    const escalated = await one(` AND status = 'Escalated'`);
    const waiting = waitingSparepart + waitingVendor;
    const onProgress = await one(` AND status = 'On Progress'`);
    const resolved = await one(` AND status = 'Resolved'`);
    const closed = await one(` AND status = 'Closed'`);
    const cancelled = groupTotals["Cancelled"];
    const createdToday = await one(
      ` AND date(created_at) = date('now','localtime')`,
    );
    const createdWeek = await one(
      ` AND date(created_at) >= date('now','localtime','-6 days')`,
    );
    const createdMonth = await one(
      ` AND date(created_at) >= date('now','localtime','start of month')`,
    );

    // Avg resolution time (hrs) over resolved/closed with timestamps.
    const avg = await db.pGet(
      `SELECT AVG((julianday(COALESCE(closed_at, resolved_at)) - julianday(created_at)) * 24) h
       FROM tickets WHERE ${W} AND (resolved_at IS NOT NULL OR closed_at IS NOT NULL)`,
      P,
    );
    // Avg first response time (minutes)
    const fr = await db.pGet(
      `SELECT AVG((julianday(first_response_at) - julianday(created_at)) * 1440) m
       FROM tickets WHERE ${W} AND first_response_at IS NOT NULL`,
      P,
    );

    // SLA achievement — resolution time vs urgency target (configurable defaults).
    const slaRows = await db.pAll(
      `SELECT urgency,
         (julianday(COALESCE(resolved_at, closed_at)) - julianday(created_at)) * 1440 AS mins
       FROM tickets
       WHERE ${W} AND (resolved_at IS NOT NULL OR closed_at IS NOT NULL)`,
      P,
    );
    let slaMet = 0,
      slaBreached = 0;
    for (const r of slaRows) {
      const target = SLA_TARGET_MINUTES[r.urgency] || SLA_TARGET_MINUTES.Medium;
      if (r.mins != null && r.mins <= target) slaMet++;
      else slaBreached++;
    }
    const slaTotal = slaMet + slaBreached;
    const slaAchievement = slaTotal
      ? Math.round((slaMet / slaTotal) * 1000) / 10
      : null;

    // Technician workload (admins only)
    let workload = [];
    if (isAdmin(req.user)) {
      const deptFilter =
        req.user.role === "AdminIT"
          ? "AND role='TechnicianIT'"
          : req.user.role === "AdminME"
            ? "AND role='TechnicianME'"
            : "AND role IN ('TechnicianIT','TechnicianME')";
      const techs = await db.pAll(
        `SELECT id, username, role FROM users WHERE is_active=1 ${deptFilter}`,
      );
      for (const t of techs) {
        const c = (
          await db.pGet(
            `SELECT COUNT(*) c FROM tickets WHERE assigned_technician_id=? AND status IN (${OPEN_ASSIGNED_STATUSES.map(() => "?").join(",")})`,
            [t.id, ...OPEN_ASSIGNED_STATUSES],
          )
        ).c;
        workload.push({
          technician: t.username,
          department: deptForRole(t.role),
          open: c,
        });
      }
      workload.sort((a, b) => b.open - a.open);
    }

    res.json({
      role: req.user.role,
      totals: {
        total,
        // Core cards (grouped) — New / Open / On Progress / Closed.
        new: newCount,
        open: groupTotals["Open"],
        on_progress: onProgress,
        // Closed card groups Resolved + Closed; `status_closed` is the exact
        // Closed count for reporting parity.
        closed: groupTotals["Closed"],
        cancelled,
        // Everything still open (any status except Closed/Cancelled).
        backlog,
        unassigned,
        // Operational detail — exact statuses, never rolled up. These keep the
        // scheduling / sparepart / vendor / escalation views visible.
        assigned,
        on_scheduled: onScheduled,
        waiting_sparepart: waitingSparepart,
        waiting_vendor: waitingVendor,
        pending_outlet_response: pendingOutlet,
        escalated,
        waiting,
        resolved,
        status_closed: closed,
        created_today: createdToday,
        created_week: createdWeek,
        created_month: createdMonth,
      },
      avg_resolution_hours: avg && avg.h ? Math.round(avg.h * 10) / 10 : null,
      avg_first_response_mins: fr && fr.m ? Math.round(fr.m) : null,
      sla: {
        met: slaMet,
        breached: slaBreached,
        achievement: slaAchievement,
        targets: SLA_TARGET_MINUTES,
      },
      byStatus,
      byStatusGroup,
      byUrgency,
      byDept,
      byBrand,
      byRegion,
      byOutlet,
      byTechnician,
      topCategories,
      workload,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to build dashboard" });
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
        return res
          .status(404)
          .json({ error: "Ticket not found or access denied" });
      if (!adminScopeForTicket(req.user, ticket))
        return res.status(403).json({ error: "Wrong department" });
      const recs = await recommendTechnicians(db, {
        department: ticket.department,
        categoryName: ticket.category,
      });
      res.json(recs);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to compute recommendation" });
    }
  },
);

// --- Comments (human) ------------------------------------------------------
router.post("/api/tickets/:id/comments", requireAuth, async (req, res) => {
  try {
    const ticket = await getVisibleTicket(req.user, req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ error: "Ticket not found or access denied" });
    // Leaders are strictly view-only.
    if (req.user.role === "Leader")
      return res.status(403).json({ error: "View-only role cannot comment" });

    const { message, attachmentIds, phase } = req.body || {};
    if (!message && !(Array.isArray(attachmentIds) && attachmentIds.length)) {
      return res
        .status(400)
        .json({ error: "A message or attachment is required" });
    }

    // Author identity is ALWAYS from the authenticated user (no spoofing).
    const r = await db.pRun(
      `INSERT INTO comments (ticket_id, author_name, author_role, author_user_id, message, is_system)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [
        ticket.id,
        req.user.username,
        req.user.role,
        req.user.id,
        message || "(attachment)",
      ],
    );
    const commentId = r.lastID;

    if (Array.isArray(attachmentIds) && attachmentIds.length) {
      const validPhase = ["before", "after", "general"].includes(phase)
        ? phase
        : "general";
      const ph = attachmentIds.map(() => "?").join(",");
      await db.pRun(
        `UPDATE attachments SET ticket_id = ?, comment_id = ?, phase = ? WHERE id IN (${ph})`,
        [ticket.id, commentId, validPhase, ...attachmentIds],
      );
    }

    // First agent/admin/tech response marks first_response_at.
    if (!ticket.first_response_at && req.user.role !== "Requestor") {
      await db.pRun(
        "UPDATE tickets SET first_response_at = CURRENT_TIMESTAMP WHERE id = ?",
        [ticket.id],
      );
    }
    await db.pRun(
      "UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [ticket.id],
    );
    await logActivity(
      ticket.id,
      req.user,
      "comment.added",
      message ? message.slice(0, 80) : "(attachment)",
    );

    res
      .status(201)
      .json(await db.pGet("SELECT * FROM comments WHERE id = ?", [commentId]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

/* Activity-log wording for a status change. Plain language, in one sentence, so
   the timeline reads without decoding:
     "T TechIT changed status from Open to On Progress."
     "T TechIT marked ticket as Waiting Sparepart. Note: waiting thermal head."
     "T TechIT marked ticket as Resolved."
   Statuses that describe a *state of the work* read better as "marked ticket
   as X"; ordinary moves along the flow read better as "from A to B". */
const MARKED_AS_STATUSES = [
  ...WAITING_STATUSES,
  "On Scheduled",
  "Escalated",
  "Resolved",
  "Cancelled",
];
function statusChangeDetail(user, from, to, body = {}) {
  const who = actorLabel(user);
  const note = (
    body.status_note ||
    (to === "Waiting Sparepart" && body.sparepart_note) ||
    (to === "Waiting Vendor" && body.vendor_note) ||
    ""
  )
    .toString()
    .trim();
  const sentence = MARKED_AS_STATUSES.includes(to)
    ? `${who} marked ticket as ${to}.`
    : `${who} changed status from ${from} to ${to}.`;
  return note ? `${sentence} Note: ${note}` : sentence;
}

router.patch("/api/tickets/:id", requireAuth, async (req, res) => {
  try {
    const ticket = await getVisibleTicket(req.user, req.params.id);
    if (!ticket)
      return res
        .status(404)
        .json({ error: "Ticket not found or access denied" });

    const b = req.body || {};
    const isDeptAdmin = adminScopeForTicket(req.user, ticket);

    /* Technician edit rights — a technician may act on a ticket when they are
       on its assignment team, in EITHER role:
         • Primary Technician / PIC  — owns the job
         • Collaborator              — helping on the job, and often the one who
                                       actually sees the field condition
       …and the ticket is in their own department (Technician IT can never touch
       an ME ticket and vice versa). An unassigned technician gets nothing. */
    const teamRole = isTechnician(req.user)
      ? await teamRoleOf(ticket, req.user.id)
      : null;
    const isTeamTech =
      !!teamRole && technicianDeptMatches(req.user, ticket);
    if (!isDeptAdmin && !isTeamTech) {
      return res.status(403).json({
        error: isTechnician(req.user)
          ? "You are not assigned to this ticket."
          : "You do not have permission to edit this ticket",
      });
    }

    const updates = [];
    const params = [];
    const set = (col, val) => {
      updates.push(`${col} = ?`);
      params.push(val);
    };
    const activities = [];

    // Status change (with guards + timestamps)
    if (b.status && b.status !== ticket.status) {
      // A technician on the team owns the whole operational middle of the flow
      // (TECHNICIAN_STATUSES) — not just the 4 core statuses. What stays out of
      // their hands: "New" (system-set), "Cancelled" (admin + reason) and
      // reopening a Closed/Cancelled ticket (admin + reason).
      if (isTeamTech && !isDeptAdmin) {
        if (TERMINAL_STATUSES.includes(ticket.status)) {
          return res.status(403).json({
            error: `This ticket is already ${ticket.status === "Closed" ? "closed" : "cancelled"}.`,
          });
        }
        if (!TECHNICIAN_STATUSES.includes(b.status)) {
          return res
            .status(403)
            .json({ error: "Technicians cannot set that status" });
        }
      }
      if (b.status === "Closed" && !canClose(req.user, ticket, { isTeamMember: isTeamTech })) {
        return res
          .status(403)
          .json({ error: "You are not allowed to close this ticket" });
      }
      const err = validateTransition(ticket, b.status, b, req.user, {
        isTeamMember: isTeamTech,
      });
      if (err) return res.status(400).json({ error: err });

      set("status", b.status);
      const nowIso = new Date().toISOString();
      // On Scheduled: record the planned schedule date/time if supplied.
      // No schedule supplied is fine — it must never block the status update.
      if (b.status === "On Scheduled" && b.scheduled_at)
        set("scheduled_at", b.scheduled_at);
      if (b.status === "On Progress" && !ticket.started_at)
        set("started_at", nowIso);
      if (b.status === "Resolved" && !ticket.resolved_at)
        set("resolved_at", nowIso);
      if (b.status === "Closed" && !ticket.closed_at) set("closed_at", nowIso);
      if (ticket.status === "Closed" && b.status !== "Closed")
        set("closed_at", null);
      // Nothing in this block touches assigned_technician_id / assignee_name or
      // any ticket_assignments row: a status change never moves the team.
      activities.push([
        "status.changed",
        statusChangeDetail(req.user, ticket.status, b.status, b),
      ]);
    }

    if (
      b.urgency &&
      URGENCIES.includes(b.urgency) &&
      b.urgency !== ticket.urgency
    ) {
      if (!isDeptAdmin)
        return res
          .status(403)
          .json({ error: "Only admins can change urgency" });
      set("urgency", b.urgency);
      activities.push(["urgency.changed", `${ticket.urgency} → ${b.urgency}`]);
    }

    // Department / category re-routing (admin only)
    if (
      b.department &&
      DEPARTMENTS.includes(b.department) &&
      b.department !== ticket.department
    ) {
      if (!isDeptAdmin)
        return res
          .status(403)
          .json({ error: "Only admins can re-route department" });
      set("department", b.department);
      activities.push([
        "department.changed",
        `${ticket.department} → ${b.department} (escalation)`,
      ]);
      // keep original ticket_number (same-ticket escalation), clear assignee if wrong dept
    }
    if (b.category) {
      const dept = b.department || ticket.department;
      const ok = await db.pGet(
        "SELECT 1 FROM categories WHERE department_code = ? AND name = ?",
        [dept, b.category],
      );
      if (!ok)
        return res
          .status(400)
          .json({ error: "Category does not belong to the ticket department" });
      if (b.category !== ticket.category) {
        set("category", b.category);
        activities.push([
          "category.changed",
          `${ticket.category} → ${b.category}`,
        ]);
      }
    }
    if (b.outlet_code && b.outlet_code !== ticket.outlet_code) {
      if (!isDeptAdmin)
        return res.status(403).json({ error: "Only admins can change outlet" });
      const o = await db.pGet(
        "SELECT brand_code, region FROM outlets WHERE code = ?",
        [b.outlet_code],
      );
      if (!o) return res.status(400).json({ error: "Unknown outlet" });
      set("outlet_code", b.outlet_code);
      set("brand_code", o.brand_code);
      set("region", o.region || "Jakarta");
      activities.push([
        "outlet.changed",
        `${ticket.outlet_code} → ${b.outlet_code}`,
      ]);
    }

    // Free-text operational fields
    const textFields = [
      "resolution_note",
      "cancel_reason",
      "sparepart_note",
      "vendor_note",
      "expected_part_date",
      "estimated_cost",
      "location_detail",
      "device_equipment",
      "business_impact",
      "contact_number",
      "preferred_visit_time",
      "scheduled_at",
      "scheduled_end",
    ];
    for (const f of textFields) {
      if (b[f] !== undefined && b[f] !== ticket[f]) set(f, b[f]);
    }

    if (!updates.length)
      return res.status(400).json({ error: "No changes provided" });
    set("updated_at", new Date().toISOString());
    if (!ticket.first_response_at && isDeptAdmin)
      set("first_response_at", new Date().toISOString());

    await db.pRun(`UPDATE tickets SET ${updates.join(", ")} WHERE id = ?`, [
      ...params,
      ticket.id,
    ]);
    for (const [action, detail] of activities)
      await logActivity(ticket.id, req.user, action, detail);

    const updated = await db.pGet("SELECT * FROM tickets WHERE id = ?", [
      ticket.id,
    ]);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

// --- Assign / reassign -----------------------------------------------------
// --- Assign / reassign / multi-technician assignment ------------------------
router.post(
  "/api/tickets/:id/assign",
  requireAuth,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const ticket = await getVisibleTicket(req.user, req.params.id);
      if (!ticket)
        return res
          .status(404)
          .json({ error: "Ticket not found or access denied" });
      if (!adminScopeForTicket(req.user, ticket))
        return res.status(403).json({ error: "Wrong department" });

      const { technician_id, action, role_type, reason, note, override } = req.body || {};
      if (!technician_id) {
        return res.status(400).json({ error: "technician_id is required" });
      }
      const why = note || reason;

      // "remove" is the only action that may target someone already on the team
      // regardless of department, so it skips the assignable checks.
      const loaded = await loadAssignableTechnician(technician_id, ticket, {
        override: !!override || action === "remove",
      });
      if (loaded.error)
        return res.status(loaded.status).json({ error: loaded.error });
      const tech = loaded.tech;

      const team = await getTeam(ticket.id);
      const targetRole =
        role_type ||
        (action === "add_collaborator"
          ? "collaborator"
          : action === "set_primary"
            ? "primary"
            : null) ||
        (!team.primary ? "primary" : "collaborator");

      if (action === "remove") {
        const onTeam = team.active.some((a) => a.technician_id === tech.id);
        if (!onTeam)
          return res
            .status(400)
            .json({ error: "This technician is not assigned to this ticket." });
        await removeAssignment(ticket, tech, req.user);
      } else if (targetRole === "primary") {
        if (team.primary && team.primary.technician_id === tech.id)
          return res
            .status(400)
            .json({ error: "This technician is already the Primary Technician." });
        await setPrimary(ticket, tech, req.user, why);
      } else {
        // Collaborator — a technician is never on the team twice.
        if (team.primary && team.primary.technician_id === tech.id)
          return res
            .status(400)
            .json({ error: "This technician is already the Primary Technician." });
        if (team.collaborators.some((c) => c.technician_id === tech.id))
          return res
            .status(400)
            .json({ error: "This technician is already a Collaborator." });
        const added = await addCollaborator(ticket, tech, req.user, why, "admin");
        if (!added.added)
          return res
            .status(400)
            .json({ error: "This technician is already assigned to this ticket." });
      }

      if (action !== "remove") {
        notify("ticket.assigned", {
          ticketId: ticket.id,
          recipients: [{ name: tech.username, email: tech.email, phone: tech.phone }],
          message: `You were assigned as ${targetRole} for ticket ${ticket.ticket_number}`,
          channels: ["in_app"],
        });
      }

      res.json(await db.pGet("SELECT * FROM tickets WHERE id = ?", [ticket.id]));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update technician assignment" });
    }
  }
);

/* --------------------------------------------------------------------------
   Collaborator invitations (technician-side)

   GET  /api/tickets/:id/assignable-technicians  — candidates + availability
   POST /api/tickets/:id/collaborators/invite    — invite one as Collaborator

   Open to a dept admin OR a technician already on the ticket's team (Primary
   or Collaborator). Everything else — requestors, unassigned technicians,
   other-department technicians — is refused.
   -------------------------------------------------------------------------- */

// Shared gate. Returns { ticket, isTeamAdmin } or { error, status }.
async function loadTicketForCollaboration(req) {
  const ticket = await getVisibleTicket(req.user, req.params.id, {
    techFilter: "all",
  });
  if (!ticket)
    return { error: "Ticket not found or access denied", status: 404 };

  const isTeamAdmin = adminScopeForTicket(req.user, ticket);
  if (isTeamAdmin) return { ticket, isTeamAdmin };

  if (!isTechnician(req.user))
    return { error: "Only assigned technicians can invite collaborators.", status: 403 };
  if (deptForRole(req.user.role) !== ticket.department)
    return { error: "You can only invite technicians from the same department.", status: 403 };
  const { active } = await getTeam(ticket.id);
  const onTeam =
    active.some((a) => a.technician_id === req.user.id) ||
    ticket.assigned_technician_id === req.user.id;
  if (!onTeam)
    return { error: "Only assigned technicians can invite collaborators.", status: 403 };
  return { ticket, isTeamAdmin: false };
}

router.get(
  "/api/tickets/:id/assignable-technicians",
  requireAuth,
  async (req, res) => {
    try {
      const loaded = await loadTicketForCollaboration(req);
      if (loaded.error)
        return res.status(loaded.status).json({ error: loaded.error });
      const { ticket } = loaded;

      const { primary, collaborators } = await getTeam(ticket.id);
      // Availability/workload come from the same engine the admin
      // recommendation list uses, so both screens agree.
      const ranked = await recommendTechnicians(db, {
        department: ticket.department,
        categoryName: ticket.category,
      });
      const candidates = ranked.map((r) => ({
        id: r.id,
        username: r.username,
        department: r.department || ticket.department,
        workload: r.workload,
        availability: r.availability,
        available: r.available,
        is_self: r.id === req.user.id,
        is_primary: !!primary && primary.technician_id === r.id,
        is_collaborator: collaborators.some((c) => c.technician_id === r.id),
      }));

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
        candidates,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list technicians" });
    }
  },
);

router.post(
  "/api/tickets/:id/collaborators/invite",
  requireAuth,
  async (req, res) => {
    try {
      const loaded = await loadTicketForCollaboration(req);
      if (loaded.error)
        return res.status(loaded.status).json({ error: loaded.error });
      const { ticket, isTeamAdmin } = loaded;

      if (TERMINAL_STATUSES.includes(ticket.status))
        return res
          .status(400)
          .json({ error: "This ticket is already closed or cancelled." });

      const { technician_id, note } = req.body || {};
      if (!technician_id)
        return res.status(400).json({ error: "technician_id is required" });
      if (Number(technician_id) === req.user.id)
        return res
          .status(400)
          .json({ error: "You are already assigned to this ticket." });

      const tech = await db.pGet(
        "SELECT id, username, email, phone, role, is_active FROM users WHERE id = ?",
        [technician_id],
      );
      if (!tech || !isTechnician({ role: tech.role }))
        return res.status(400).json({ error: "Not a valid technician" });
      if (tech.is_active === 0)
        return res.status(400).json({ error: "Technician is inactive" });
      // No override here — invites never cross departments, for admins either.
      if (deptForRole(tech.role) !== ticket.department)
        return res
          .status(400)
          .json({ error: "You can only invite technicians from the same department." });

      // Re-read the team immediately before inserting so a double-click cannot
      // create two rows for the same technician.
      const { primary, collaborators } = await getTeam(ticket.id);
      if (primary && primary.technician_id === tech.id)
        return res
          .status(400)
          .json({ error: "This technician is already the Primary Technician." });
      if (collaborators.some((c) => c.technician_id === tech.id))
        return res
          .status(400)
          .json({ error: "This technician is already a Collaborator." });

      const added = await addCollaborator(
        ticket,
        tech,
        req.user,
        note,
        isTeamAdmin ? "admin" : "invite",
      );
      // Lost a race with a concurrent identical invite (double-click): the row
      // already exists, so report it as such instead of inventing a duplicate.
      if (!added.added)
        return res
          .status(400)
          .json({ error: "This technician is already assigned to this ticket." });

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
        // Status is untouched by an invite — echoed so the client can prove it.
        status: ticket.status,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to invite collaborator" });
    }
  },
);

// --- Self-assignment (technicians) -----------------------------------------
router.post("/api/tickets/:id/assign-to-me", requireAuth, async (req, res) => {
  try {
    if (!isTechnician(req.user))
      return res
        .status(403)
        .json({ error: "Only technicians can self-assign tickets" });

    const ticket = await getVisibleTicket(req.user, req.params.id, {
      techFilter: "all",
    });
    if (!ticket)
      return res
        .status(404)
        .json({ error: "Ticket not found or outside your allowed scope" });

    const techDept = deptForRole(req.user.role);
    if (ticket.department !== techDept)
      return res
        .status(403)
        .json({ error: "You can only take tickets in your own department" });

    if (["Closed", "Cancelled"].includes(ticket.status))
      return res
        .status(400)
        .json({ error: "This ticket is already closed or cancelled" });

    const selfAssignment = await db.pGet(
      "SELECT * FROM ticket_assignments WHERE ticket_id = ? AND technician_id = ? AND active = 1",
      [ticket.id, req.user.id]
    );
    if (selfAssignment) {
      return res.status(400).json({
        error: `You are already assigned as ${selfAssignment.role_type || 'primary'} to this ticket.`
      });
    }

    const currentPrimary = await db.pGet(
      "SELECT * FROM ticket_assignments WHERE ticket_id = ? AND role_type = 'primary' AND active = 1",
      [ticket.id]
    );

    const roleType = !currentPrimary ? "primary" : "collaborator";

    await db.pRun(
      "INSERT INTO ticket_assignments (ticket_id, technician_id, assigned_by, reason, role_type, active, is_active) VALUES (?, ?, ?, ?, ?, 1, 1)",
      [ticket.id, req.user.id, req.user.id, "self-assignment", roleType]
    );

    if (roleType === "primary") {
      // Self-assignment records the technician but leaves the status untouched.
      await db.pRun(
        `UPDATE tickets SET assigned_technician_id = ?, assignee_name = ?,
           assigned_at = COALESCE(assigned_at, CURRENT_TIMESTAMP),
           first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [req.user.id, req.user.username, ticket.id]
      );
    } else {
      await db.pRun(
        "UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [ticket.id]
      );
    }

    await logActivity(
      ticket.id,
      req.user,
      "ticket.assigned",
      `Self-assigned as ${roleType} technician (${req.user.username})`
    );

    res.json(await db.pGet("SELECT * FROM tickets WHERE id = ?", [ticket.id]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to self-assign ticket" });
  }
});

// --- Create ticket ---------------------------------------------------------
// double-submit guard (very short window)
const recentCreates = new Map();

router.post("/api/tickets", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const department = String(b.department || "").toUpperCase();
    if (!DEPARTMENTS.includes(department))
      return res.status(400).json({ error: "Department must be IT or ME" });
    if (!b.outlet_code)
      return res.status(400).json({ error: "Outlet is required" });
    if (!b.category)
      return res.status(400).json({ error: "Category is required" });
    if (!b.description && !b.title)
      return res
        .status(400)
        .json({ error: "A short issue description is required" });

    // Validate category belongs to department.
    const cat = await db.pGet(
      "SELECT 1 FROM categories WHERE department_code = ? AND name = ?",
      [department, b.category],
    );
    if (!cat)
      return res
        .status(400)
        .json({
          error: `Category "${b.category}" does not belong to ${department}`,
        });

    // Derive brand + region from outlet.
    const outlet = await db.pGet(
      "SELECT code, brand_code, region FROM outlets WHERE code = ?",
      [b.outlet_code],
    );
    if (!outlet) return res.status(400).json({ error: "Unknown outlet" });
    const brand_code = outlet.brand_code || null;
    const region = outlet.region || "Jakarta";

    const urgency = URGENCIES.includes(b.urgency) ? b.urgency : "Medium";
    const reportMode = b.report_mode === "detailed" ? "detailed" : "quick";

    // Requestor identity: explicit requestor name from form if provided, defaulting to logged in user.
    const requestorName =
      b.requestor_name || b.customer_name || req.user.username;
    const requestorEmail =
      b.customer_email || req.user.email;

    // Double-click guard: same user + outlet + category + text within 8s → reject softly.
    const fp = crypto
      .createHash("sha1")
      .update(
        `${req.user.id}|${b.outlet_code}|${b.category}|${b.description || b.title || ""}`,
      )
      .digest("hex");
    const last = recentCreates.get(fp);
    if (last && Date.now() - last < 8000) {
      return res
        .status(409)
        .json({
          error: "Looks like a duplicate submission — please wait a moment.",
        });
    }
    recentCreates.set(fp, Date.now());

    const title =
      b.title ||
      (b.description
        ? String(b.description).slice(0, 80)
        : `${b.category} issue`);
    const ticketNumber = await nextTicketNumber(department);

    const r = await db.pRun(
      `INSERT INTO tickets
        (ticket_number, title, description, department, category, outlet_code, brand_code, region,
         status, urgency, report_mode, requestor_user_id, customer_name, customer_email,
         contact_person, contact_number, location_detail, device_equipment, business_impact,
         preferred_visit_time, occurrence_at, scheduled_at, scheduled_end, assignee_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unassigned')`,
      [
        ticketNumber,
        title,
        b.description || title,
        department,
        b.category,
        outlet.code,
        brand_code,
        region,
        urgency,
        reportMode,
        req.user.id,
        requestorName,
        requestorEmail,
        b.contact_person || requestorName,
        b.contact_number || null,
        b.location_detail || null,
        b.device_equipment || null,
        b.business_impact || null,
        b.preferred_visit_time || null,
        b.occurrence_at || null,
        b.scheduled_at || null,
        b.scheduled_end || null,
      ],
    );
    const ticketId = r.lastID;

    // Link any pre-uploaded attachments.
    if (Array.isArray(b.attachmentIds) && b.attachmentIds.length) {
      const ph = b.attachmentIds.map(() => "?").join(",");
      await db.pRun(
        `UPDATE attachments SET ticket_id = ? WHERE id IN (${ph}) AND ticket_id IS NULL`,
        [ticketId, ...b.attachmentIds],
      );
    }

    await logActivity(
      ticketId,
      req.user,
      "ticket.created",
      `${ticketNumber} • ${department}/${b.category} • ${outlet.code}`,
    );

    // Notify department admins (in-app).
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

    const displayTicketNumber = outlet.code ? `${ticketNumber} - ${outlet.code}` : ticketNumber;
    const ticketUrl = `${APP_URL}/tickets/${ticketId}`;

    // Notify customer (WhatsApp) if a contact number was provided.
    if (b.contact_number) {
      notify("ticket.created", {
        ticketId,
        ticketNumber: displayTicketNumber,
        recipients: [
          {
            name: b.contact_person || requestorName,
            phone: b.contact_number,
          },
        ],
        message: `Tiket pelaporan anda telah berhasil dibuat!\n\n• *Nomor Tiket*: ${displayTicketNumber}\n👉 ${ticketUrl}`,
        channels: ["whatsapp"],
      });
    }

    // Notify Technicians / WhatsApp Group
    const techGroupTarget = (department === 'ME' ? process.env.FONNTE_WA_GROUP_ME : process.env.FONNTE_WA_GROUP_IT) || process.env.FONNTE_WA_GROUP || '120363410098180945@g.us';
    const techWaRecipients = [];
    if (techGroupTarget) {
      techWaRecipients.push({ name: `${department} Technician Group`, phone: techGroupTarget });
    }
    const techsWithPhone = await db.pAll(
      `SELECT username, phone FROM users WHERE is_active = 1 AND phone IS NOT NULL AND phone != '' AND role IN ('SuperAdmin', ?, ?)`,
      [department === "IT" ? "AdminIT" : "AdminME", department === "IT" ? "TechnicianIT" : "TechnicianME"]
    );
    for (const t of techsWithPhone) {
      if (!techWaRecipients.some(r => r.phone === t.phone)) {
        techWaRecipients.push({ name: t.username, phone: t.phone });
      }
    }

    if (techWaRecipients.length > 0) {
      const groupAlertMessage = `🚨 *TIKET BARU TERBUAT* 🚨\n• *Nomor Tiket*: ${displayTicketNumber}\n👉 ${ticketUrl}\n• *Departemen*: ${department}\n• *Kategori*: ${b.category || '—'}\n• *Outlet*: ${outlet.code || '—'}\n• *Pelapor*: ${b.contact_person || requestorName}${b.contact_number ? ' (' + b.contact_number + ')' : ''}\n• *Deskripsi*: ${b.description || '—'}`;
      notify("ticket.created", {
        ticketId,
        ticketNumber: displayTicketNumber,
        recipients: techWaRecipients,
        message: groupAlertMessage,
        channels: ["whatsapp"],
      });
    }

    const ticket = await db.pGet("SELECT * FROM tickets WHERE id = ?", [
      ticketId,
    ]);
    res.status(201).json(ticket);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create ticket" });
  }
});

module.exports = router;
