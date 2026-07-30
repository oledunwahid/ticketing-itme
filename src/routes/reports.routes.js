/* ==========================================================================
   Routes — Reporting & Managerial Performance (/api/reports/*)
     GET /api/reports/tickets       (scoped, filtered JSON — created_at DESC)
     GET /api/reports/performance   (executive summary, technician performance,
                                     outlet/region/dept rollups, SLA detail,
                                     scheduled monitoring, manager insights)
     GET /api/reports/export        (CSV: raw | technician | sla)
   RBAC: SuperAdmin, AdminIT, AdminME, Leader. Requestors & technicians cannot
   reach this router. AdminIT/AdminME are department-scoped by buildTicketScope.
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { buildTicketScope } = require("../utils/permissions");
const {
  DEPARTMENTS,
  STATUS_GROUPS,
  statusesInGroup,
} = require("../config/constants");
const {
  getSlaTargets,
  enrichTicket,
  summarize,
  buildInsights,
  avg,
} = require("../utils/reporting");

const router = express.Router();

const REPORT_ROLES = ["SuperAdmin", "AdminIT", "AdminME", "Leader"];

// --- Shared: build the scoped + filtered ticket query ----------------------
async function scopedTicketSql(user, q) {
  const scope = await buildTicketScope(user);
  const clause = scope.clause
    .replace(
      /\b(requestor_user_id|customer_email|assigned_technician_id|department|brand_code|outlet_code)\b/g,
      "t.$1",
    )
    // The technician scope correlates a subquery on tickets.id; here the table
    // is aliased, so the qualified reference has to follow the alias.
    .replace(/\btickets\.id\b/g, "t.id");
  let sql = `SELECT t.*, o.display_label AS outlet_display, o.region AS outlet_region
             FROM tickets t
             LEFT JOIN outlets o ON o.code = t.outlet_code
             WHERE ${clause}`;
  const params = [...scope.params];
  const add = (frag, ...v) => {
    sql += frag;
    params.push(...v);
  };
  if (q.department && DEPARTMENTS.includes(q.department))
    add(" AND t.department = ?", q.department);
  if (q.region) add(" AND COALESCE(t.region, o.region, 'Jakarta') = ?", q.region);
  if (q.brand) add(" AND t.brand_code = ?", q.brand);
  if (q.outlet) add(" AND t.outlet_code = ?", q.outlet);
  // Reports filter on the ACTUAL status. status_group is an optional extra
  // (New/Open/On Progress/Closed/Cancelled) that expands to its member
  // statuses — it never collapses or rewrites the stored value.
  if (q.status) add(" AND t.status = ?", q.status);
  if (q.status_group && STATUS_GROUPS.includes(q.status_group)) {
    const members = statusesInGroup(q.status_group);
    add(` AND t.status IN (${members.map(() => "?").join(",")})`, ...members);
  }
  if (q.category) add(" AND t.category = ?", q.category);
  if (q.urgency) add(" AND t.urgency = ?", q.urgency);
  if (q.technician) add(" AND t.assignee_name = ?", q.technician);
  if (q.start_date) add(" AND date(t.created_at) >= date(?)", q.start_date);
  if (q.end_date) add(" AND date(t.created_at) <= date(?)", q.end_date);
  if (q.scheduled_from)
    add(" AND date(t.scheduled_at) >= date(?)", q.scheduled_from);
  if (q.scheduled_to)
    add(" AND date(t.scheduled_at) <= date(?)", q.scheduled_to);
  sql += " ORDER BY t.created_at DESC"; // newest first (urgency never default)
  return { sql, params };
}

// Fetch scoped + filtered rows, enrich with SLA/timing fields, apply the
// post-query sla_status filter (computed, not a column).
async function fetchEnriched(user, q) {
  const { sql, params } = await scopedTicketSql(user, q);
  const targets = await getSlaTargets();
  const now = Date.now();
  let rows = (await db.pAll(sql, params)).map((t) =>
    enrichTicket(
      { ...t, region: t.region || t.outlet_region || "Jakarta" },
      targets,
      now,
    ),
  );
  if (q.sla_status) rows = rows.filter((r) => r.sla_status === q.sla_status);
  return { rows, targets, now };
}

// --- GET /api/reports/tickets (raw filtered JSON) --------------------------
router.get(
  "/api/reports/tickets",
  requireAuth,
  requireRole(...REPORT_ROLES),
  async (req, res) => {
    try {
      if (
        req.query.start_date &&
        req.query.end_date &&
        req.query.start_date > req.query.end_date
      )
        return res
          .status(400)
          .json({ error: "Start date must be before end date" });
      const { rows } = await fetchEnriched(req.user, req.query);
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to run report" });
    }
  },
);

// --- Aggregation helpers ---------------------------------------------------
function buildTechnicians(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.assigned_technician_id) continue;
    const key = r.assigned_technician_id;
    let g = map.get(key);
    if (!g) {
      g = {
        technician_id: key,
        technician: r.assignee_name || "Unknown",
        department: r.department || "—",
        rows: [],
      };
      map.set(key, g);
    }
    g.rows.push(r);
  }
  return map;
}
function techMetrics(g) {
  const rs = g.rows;
  return {
    technician_id: g.technician_id,
    technician: g.technician,
    department: g.department,
    assigned: rs.length,
    resolved: rs.filter((r) => ["Resolved", "Closed"].includes(r.status)).length,
    closed: rs.filter((r) => r.status === "Closed").length,
    open_workload: rs.filter((r) => r.is_backlog).length,
    avg_first_response_mins: avg(rs.map((r) => r.first_response_mins)),
    avg_start_mins: avg(rs.map((r) => r.start_mins)),
    avg_resolution_mins: avg(
      rs
        .filter((r) => ["Resolved", "Closed"].includes(r.status))
        .map((r) => r.resolution_mins),
    ),
    sla_met: rs.filter((r) => r.sla_status === "Met").length,
    sla_breached: rs.filter((r) => r.sla_status === "Breached").length,
    waiting: rs.filter((r) =>
      ["Waiting Sparepart", "Waiting Vendor"].includes(r.status),
    ).length,
    scheduled_not_started: rs.filter(
      (r) => r.status === "On Scheduled" && !r.started_at,
    ).length,
  };
}
function withAchievement(t) {
  const denom = t.sla_met + t.sla_breached;
  t.sla_achievement =
    denom > 0 ? Math.round((t.sla_met / denom) * 1000) / 10 : null;
  return t;
}

function groupAgg(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === "") continue;
    let g = m.get(k);
    if (!g) {
      g = { key: k, total: 0, sla_breached: 0, res: [] };
      m.set(k, g);
    }
    g.total++;
    if (r.sla_status === "Breached") g.sla_breached++;
    if (["Resolved", "Closed"].includes(r.status)) g.res.push(r.resolution_mins);
  }
  return m;
}

async function buildPerformance(user, q) {
  const { rows, targets, now } = await fetchEnriched(user, q);
  const summary = summarize(rows);

  // Technician performance (merge roster so 0-ticket techs still show).
  const techMap = buildTechnicians(rows);
  const technicians = [...techMap.values()].map((g) =>
    withAchievement(techMetrics(g)),
  );
  const deptFilter =
    user.role === "AdminIT"
      ? "role='TechnicianIT'"
      : user.role === "AdminME"
        ? "role='TechnicianME'"
        : "role IN ('TechnicianIT','TechnicianME')";
  const roster = await db.pAll(
    `SELECT id, username, role, region, pic_area,
       (SELECT COUNT(*) FROM user_outlet_access WHERE user_id = users.id) AS coverage
     FROM users WHERE is_active = 1 AND ${deptFilter}`,
  );
  const byId = new Map(technicians.map((t) => [t.technician_id, t]));
  for (const u of roster) {
    const dep = u.role === "TechnicianIT" ? "IT" : "ME";
    let t = byId.get(u.id);
    if (!t) {
      t = withAchievement({
        technician_id: u.id,
        technician: u.username,
        department: dep,
        assigned: 0,
        resolved: 0,
        closed: 0,
        open_workload: 0,
        avg_first_response_mins: null,
        avg_start_mins: null,
        avg_resolution_mins: null,
        sla_met: 0,
        sla_breached: 0,
        waiting: 0,
        scheduled_not_started: 0,
      });
      technicians.push(t);
      byId.set(u.id, t);
    }
    t.region = u.region || null;
    t.pic_area = u.pic_area || null;
    t.coverage = u.coverage || 0;
  }
  technicians.sort((a, b) => b.assigned - a.assigned);

  // Outlet / region / brand / category rollups.
  const outlets = [...groupAgg(rows, (r) => r.outlet_display || r.outlet_code).values()]
    .map((g) => ({
      outlet: g.key,
      total: g.total,
      sla_breached: g.sla_breached,
      avg_resolution_mins: avg(g.res),
    }))
    .sort((a, b) => b.total - a.total);
  const regions = [...groupAgg(rows, (r) => r.region).values()]
    .map((g) => ({
      region: g.key,
      total: g.total,
      sla_breached: g.sla_breached,
      avg_resolution_mins: avg(g.res),
    }))
    .sort((a, b) => b.total - a.total);
  const brands = [...groupAgg(rows, (r) => r.brand_code).values()]
    .map((g) => ({ brand: g.key, total: g.total, sla_breached: g.sla_breached }))
    .sort((a, b) => b.total - a.total);
  const categories = [
    ...groupAgg(rows, (r) => (r.category ? `${r.department}||${r.category}` : null)).values(),
  ]
    .map((g) => {
      const [department, category] = g.key.split("||");
      return { department, category, total: g.total, sla_breached: g.sla_breached };
    })
    .sort((a, b) => b.total - a.total);

  // Recurring: same outlet + same category more than once.
  const recurring = [
    ...groupAgg(rows, (r) =>
      r.category && (r.outlet_display || r.outlet_code)
        ? `${r.outlet_display || r.outlet_code}||${r.category}`
        : null,
    ).values(),
  ]
    .filter((g) => g.total > 1)
    .map((g) => {
      const [outlet, category] = g.key.split("||");
      return { outlet, category, count: g.total };
    })
    .sort((a, b) => b.count - a.count);
  // annotate outlets with their worst recurring category count
  for (const o of outlets) {
    const rec = recurring.filter((x) => x.outlet === o.outlet);
    o.recurring = rec.length ? rec[0].count : 0;
  }

  // Department performance (IT vs ME) within scope.
  const departments = ["IT", "ME"]
    .map((dep) => {
      const rs = rows.filter((r) => r.department === dep);
      if (!rs.length && !technicians.some((t) => t.department === dep))
        return null;
      const met = rs.filter((r) => r.sla_status === "Met").length;
      const br = rs.filter((r) => r.sla_status === "Breached").length;
      return {
        department: dep,
        total: rs.length,
        backlog: rs.filter((r) => r.is_backlog).length,
        avg_resolution_mins: avg(
          rs
            .filter((r) => ["Resolved", "Closed"].includes(r.status))
            .map((r) => r.resolution_mins),
        ),
        sla_achievement:
          met + br > 0 ? Math.round((met / (met + br)) * 1000) / 10 : null,
        waiting: rs.filter((r) =>
          ["Waiting Sparepart", "Waiting Vendor"].includes(r.status),
        ).length,
        on_scheduled: rs.filter((r) => r.status === "On Scheduled").length,
        technicians: technicians.filter((t) => t.department === dep).length,
      };
    })
    .filter(Boolean);

  // Scheduled monitoring (On Scheduled tickets).
  const sched = rows.filter((r) => r.status === "On Scheduled");
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAhead = now + 7 * 24 * 3600 * 1000;
  const schedMs = (r) => (r.scheduled_at ? Date.parse(String(r.scheduled_at).replace(" ", "T") + "Z") : null);
  const scheduled = {
    total: sched.length,
    today: sched.filter(
      (r) => r.scheduled_at && String(r.scheduled_at).slice(0, 10) === todayStr,
    ).length,
    this_week: sched.filter((r) => {
      const m = schedMs(r);
      return m != null && m >= now && m <= weekAhead;
    }).length,
    overdue: sched.filter((r) => {
      const m = schedMs(r);
      return m != null && m < now;
    }).length,
    not_started: sched.filter((r) => !r.started_at).length,
    not_assigned: sched.filter((r) => !r.assigned_technician_id).length,
    list: sched
      .map((r) => ({
        ticket_number: r.ticket_number,
        outlet: r.outlet_display || r.outlet_code,
        region: r.region,
        category: r.category,
        technician: r.assigned_technician_id ? r.assignee_name : null,
        scheduled_at: r.scheduled_at || null,
        scheduled_end: r.scheduled_end || null,
        started: !!r.started_at,
      }))
      .sort((a, b) => String(a.scheduled_at || "").localeCompare(String(b.scheduled_at || ""))),
  };

  const agg = {
    summary,
    technicians,
    outlets,
    regions,
    brands,
    categories,
    recurring,
    departments,
    scheduled,
    targets,
  };
  const insights = buildInsights(agg, {
    department: q.department || null,
    period_label:
      q.start_date || q.end_date
        ? `${q.start_date || "start"} → ${q.end_date || "now"}`
        : "the selected period",
  });
  return { ...agg, insights, tickets: rows };
}

// --- GET /api/reports/performance ------------------------------------------
router.get(
  "/api/reports/performance",
  requireAuth,
  requireRole(...REPORT_ROLES),
  async (req, res) => {
    try {
      if (
        req.query.start_date &&
        req.query.end_date &&
        req.query.start_date > req.query.end_date
      )
        return res
          .status(400)
          .json({ error: "Start date must be before end date" });
      res.json(await buildPerformance(req.user, req.query));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to build performance report" });
    }
  },
);

// --- CSV helpers -----------------------------------------------------------
const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
function toCsv(header, cols, rows) {
  let csv = "﻿" + header.join(",") + "\n";
  for (const r of rows) csv += cols.map((c) => esc(typeof c === "function" ? c(r) : r[c])).join(",") + "\n";
  return csv;
}
function sendCsv(res, name, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${name}_${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csv);
}
const dur = (m) => (m == null ? "" : m);

// --- GET /api/reports/export?export=raw|technician|sla ---------------------
router.get(
  "/api/reports/export",
  requireAuth,
  requireRole(...REPORT_ROLES),
  async (req, res) => {
    try {
      const kind = req.query.export || "raw";
      if (kind === "technician") {
        const perf = await buildPerformance(req.user, req.query);
        const header = [
          "Technician", "Department", "Region", "PIC Area", "Coverage Outlets",
          "Assigned", "Resolved", "Closed", "Open Workload",
          "Avg First Response (min)", "Avg Start (min)", "Avg Resolution (min)",
          "SLA Met", "SLA Breached", "SLA %", "Waiting", "Scheduled Not Started",
        ];
        const cols = [
          "technician", "department", (r) => r.region || "", (r) => r.pic_area || "",
          (r) => r.coverage || 0, "assigned", "resolved", "closed", "open_workload",
          (r) => dur(r.avg_first_response_mins), (r) => dur(r.avg_start_mins),
          (r) => dur(r.avg_resolution_mins), "sla_met", "sla_breached",
          (r) => (r.sla_achievement == null ? "" : r.sla_achievement),
          "waiting", "scheduled_not_started",
        ];
        return sendCsv(res, "technician_performance", toCsv(header, cols, perf.technicians));
      }
      if (kind === "sla") {
        const { rows } = await fetchEnriched(req.user, req.query);
        const header = [
          "Ticket", "Created", "Region", "Brand", "Outlet", "Dept", "Category",
          "Urgency", "Status", "Technician", "Assigned At", "Started At",
          "Resolved At", "Closed At", "SLA Target (min)", "SLA Deadline",
          "SLA Status", "Breach (min)", "Aging (min)",
        ];
        const cols = [
          "ticket_number", "created_at", "region", "brand_code",
          (r) => r.outlet_display || r.outlet_code, "department", "category",
          "urgency", "status", "assignee_name", "assigned_at", "started_at",
          "resolved_at", "closed_at", "sla_target_minutes", "sla_deadline_at",
          "sla_status", "breach_minutes", "aging_minutes",
        ];
        return sendCsv(res, "sla_detail", toCsv(header, cols, rows));
      }
      // raw (default) — filtered ticket data with region / SLA / aging / scheduled
      const { rows } = await fetchEnriched(req.user, req.query);
      const header = [
        "Ticket", "Dept", "Region", "Category", "Outlet", "Brand", "Status",
        "Urgency", "Requestor", "Assignee", "Scheduled", "Scheduled End",
        "Created", "Assigned At", "Started At", "Resolved", "Closed",
        "SLA Status", "SLA Deadline", "Aging (min)",
      ];
      const cols = [
        "ticket_number", "department", "region", "category",
        (r) => r.outlet_display || r.outlet_code, "brand_code", "status",
        "urgency", "customer_name", "assignee_name", "scheduled_at",
        "scheduled_end", "created_at", "assigned_at", "started_at",
        "resolved_at", "closed_at", "sla_status", "sla_deadline_at",
        "aging_minutes",
      ];
      sendCsv(res, "report", toCsv(header, cols, rows));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to export" });
    }
  },
);

module.exports = router;
