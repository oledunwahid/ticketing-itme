/* ==========================================================================
   Routes — Analytics (BI dashboard)
     GET /api/analytics          every dataset the dashboard draws, computed
                                 from ONE scoped + filtered snapshot so every
                                 visual agrees
     GET /api/analytics/export   ?format=xlsx (one sheet per visual + tickets)
                                 ?format=csv  (ticket detail rows)

   Filters (all optional):
     from, to            YYYY-MM-DD, local calendar days (default: last 30 days)
     department, region, brand, outlet, category, urgency, technician (user id),
     stage (New | Open | On Progress | Closed | Cancelled), source
   Visibility is always capped by buildTicketScope — filters only narrow it.

   Time semantics
     • "created" counts use created_at inside the range
     • "resolved" counts use the resolution time (resolved_at, else closed_at)
       inside the range, whatever the creation date
     • backlog / overdue are "now" snapshots (plus a backlog-over-time series)
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth } = require("../middleware/auth");
const { buildTicketScope, isTechnician } = require("../utils/permissions");
const {
  DEPARTMENTS,
  URGENCIES,
  STATUSES,
  STATUS_GROUPS,
  statusGroup,
  WAITING_STATUSES,
} = require("../config/constants");
const { getSlaTargets, enrichTicket, ms: parseMs } = require("../utils/reporting");
const { toCsv } = require("../utils/csv");
const { buildXlsx } = require("../utils/xlsx");
const { isDate } = require("../utils/validate");

const router = express.Router();

const DAY = 86400000;
const pad2 = (n) => String(n).padStart(2, "0");
const localDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const dayStart = (s) => new Date(`${s}T00:00:00`).getTime();
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const DONE = ["Resolved", "Closed"];
const TERMINAL = ["Resolved", "Closed", "Cancelled"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RES_BUCKETS = [
  { key: "lt1h", label: "< 1 hour", max: 60 },
  { key: "1to4h", label: "1–4 hours", max: 240 },
  { key: "4to24h", label: "4–24 hours", max: 1440 },
  { key: "1to3d", label: "1–3 days", max: 4320 },
  { key: "3to7d", label: "3–7 days", max: 10080 },
  { key: "gt7d", label: "> 7 days", max: Infinity },
];

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function readFilters(q) {
  const str = (v, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const today = localDay(Date.now());
  let from = str(q.from, 10);
  let to = str(q.to, 10);
  if (from && !isDate(from)) return { error: "from must be a date (YYYY-MM-DD)" };
  if (to && !isDate(to)) return { error: "to must be a date (YYYY-MM-DD)" };
  if (!to) to = today;
  if (!from) from = localDay(dayStart(to) - 29 * DAY);
  if (from > to) return { error: "The start date must be before the end date" };
  const spanDays = Math.round((dayStart(to) - dayStart(from)) / DAY) + 1;
  if (spanDays > 3 * 366) return { error: "Pick a range of three years or less" };
  const technician = str(q.technician, 12);
  const f = {
    from,
    to,
    spanDays,
    department: DEPARTMENTS.includes(str(q.department)) ? str(q.department) : "",
    region: str(q.region),
    brand: str(q.brand),
    outlet: str(q.outlet),
    category: str(q.category),
    urgency: URGENCIES.includes(str(q.urgency)) ? str(q.urgency) : "",
    technician: technician === "none" ? "none" : /^\d+$/.test(technician) ? Number(technician) : "",
    stage: STATUS_GROUPS.includes(str(q.stage)) ? str(q.stage) : "",
    source: ["public_quick_report", "authenticated"].includes(str(q.source)) ? str(q.source) : "",
  };
  return { filters: f };
}

async function loadRows(user, f) {
  const scope = await buildTicketScope(user, { techFilter: "all" });
  let where = scope.clause;
  const params = [...scope.params];
  const add = (sql, v) => { where += sql; if (v !== undefined) params.push(v); };
  if (f.department) add(" AND department = ?", f.department);
  if (f.region) add(" AND COALESCE(region, 'Jakarta') = ?", f.region);
  if (f.brand) add(" AND brand_code = ?", f.brand);
  if (f.outlet) add(" AND outlet_code = ?", f.outlet);
  if (f.category) add(" AND category = ?", f.category);
  if (f.urgency) add(" AND urgency = ?", f.urgency);
  if (f.technician === "none") add(" AND assigned_technician_id IS NULL");
  else if (f.technician) add(" AND assigned_technician_id = ?", f.technician);
  if (f.source) add(" AND COALESCE(source, 'authenticated') = ?", f.source);
  if (f.stage) {
    const members = STATUSES.filter((s) => statusGroup(s) === f.stage);
    add(` AND status IN (${members.map(() => "?").join(",")})`);
    params.push(...members);
  }
  const rows = await db.pAll(
    `SELECT id, ticket_number, title, status, urgency, department, category, brand_code, outlet_code,
            COALESCE(region, 'Jakarta') AS region, COALESCE(source, 'authenticated') AS source,
            assigned_technician_id, assignee_name, customer_name, created_at, updated_at,
            first_response_at, assigned_at, started_at, resolved_at, closed_at, scheduled_at
       FROM tickets WHERE ${where}
      ORDER BY created_at DESC, id DESC`,
    params,
  );
  // Filter options come from the unfiltered scope so choices never vanish.
  const opt = await db.pAll(
    `SELECT DISTINCT department, COALESCE(region, 'Jakarta') AS region, brand_code, outlet_code, category,
            assigned_technician_id, assignee_name
       FROM tickets WHERE ${scope.clause}`,
    scope.params,
  );
  return { rows, opt };
}

// ---------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------
function bucketsFor(f) {
  const gran = f.spanDays <= 45 ? "day" : f.spanDays <= 26 * 7 ? "week" : "month";
  const start = dayStart(f.from);
  const endExcl = dayStart(f.to) + DAY;
  const buckets = [];
  if (gran === "day") {
    for (let t = start; t < endExcl; t = new Date(new Date(t).setDate(new Date(t).getDate() + 1)).getTime()) {
      const next = new Date(new Date(t).setDate(new Date(t).getDate() + 1)).getTime();
      buckets.push({ key: localDay(t), start: t, end: next });
    }
  } else if (gran === "week") {
    // Weeks start on Monday.
    const d0 = new Date(start);
    const shift = (d0.getDay() + 6) % 7;
    let t = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - shift).getTime();
    while (t < endExcl) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
      buckets.push({ key: localDay(t), start: Math.max(t, start), end: Math.min(next, endExcl) });
      t = next;
    }
  } else {
    const d0 = new Date(start);
    let t = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
    while (t < endExcl) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      buckets.push({ key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, start: Math.max(t, start), end: Math.min(next, endExcl) });
      t = next;
    }
  }
  return { gran, buckets, start, endExcl };
}
const bucketIndex = (buckets, t) => {
  let lo = 0, hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < buckets[mid].start) hi = mid - 1;
    else if (t >= buckets[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
function periodKpis(list, start, endExcl, now) {
  const created = list.filter((t) => t._c != null && t._c >= start && t._c < endExcl);
  const resolved = list.filter((t) => t._r != null && t._r >= start && t._r < endExcl);
  const met = resolved.filter((t) => t._e.sla_status === "Met").length;
  const breached = resolved.filter((t) => t._e.sla_status === "Breached").length;
  const resMins = resolved.map((t) => t._e.resolution_mins).filter((n) => n != null && n >= 0);
  const frMins = created.map((t) => t._e.first_response_mins).filter((n) => n != null && n >= 0);
  return {
    created: created.length,
    resolved: resolved.length,
    cancelled: created.filter((t) => t.status === "Cancelled").length,
    sla_met: met,
    sla_breached: breached,
    sla_pct: met + breached ? round1((met / (met + breached)) * 100) : null,
    mttr_hours: resMins.length ? round1(avg(resMins) / 60) : null,
    median_resolution_hours: resMins.length ? round1(median(resMins) / 60) : null,
    first_response_mins: frMins.length ? Math.round(avg(frMins)) : null,
    resolution_rate: created.length ? round1((created.filter((t) => DONE.includes(t.status)).length / created.length) * 100) : null,
    _created: created,
    _resolved: resolved,
    now,
  };
}

function aggregate(rows, f, targets, user) {
  const now = Date.now();
  for (const t of rows) {
    t._e = enrichTicket(t, targets, now);
    t._c = parseMs(t.created_at);
    t._r = DONE.includes(t.status) ? (parseMs(t.resolved_at) ?? parseMs(t.closed_at)) : null;
    t._x = t.status === "Cancelled" ? (parseMs(t.closed_at) ?? parseMs(t.updated_at)) : null;
  }
  const { gran, buckets, start, endExcl } = bucketsFor(f);
  const span = endExcl - start;
  const cur = periodKpis(rows, start, endExcl, now);
  const prev = periodKpis(rows, start - span, start, now);

  const open = rows.filter((t) => !TERMINAL.includes(t.status));
  const kpis = {
    created: cur.created,
    resolved: cur.resolved,
    sla_pct: cur.sla_pct,
    sla_met: cur.sla_met,
    sla_breached: cur.sla_breached,
    mttr_hours: cur.mttr_hours,
    median_resolution_hours: cur.median_resolution_hours,
    first_response_mins: cur.first_response_mins,
    resolution_rate: cur.resolution_rate,
    backlog_now: open.length,
    unassigned_now: open.filter((t) => !t.assigned_technician_id).length,
    overdue_now: open.filter((t) => t._e.sla_status === "Breached").length,
    at_risk_now: open.filter((t) => t._e.sla_status === "At Risk").length,
    critical_now: open.filter((t) => t.urgency === "Critical").length,
    waiting_now: open.filter((t) => WAITING_STATUSES.includes(t.status)).length,
    prev: {
      created: prev.created,
      resolved: prev.resolved,
      sla_pct: prev.sla_pct,
      mttr_hours: prev.mttr_hours,
      first_response_mins: prev.first_response_mins,
      resolution_rate: prev.resolution_rate,
    },
  };

  // Trend: created / resolved per bucket + backlog level at each bucket end.
  const trend = buckets.map((b) => ({ key: b.key, created: 0, resolved: 0, backlog: 0, IT: 0, ME: 0 }));
  for (const t of rows) {
    if (t._c != null) {
      const i = bucketIndex(buckets, t._c);
      if (i >= 0) {
        trend[i].created++;
        if (t.department === "IT" || t.department === "ME") trend[i][t.department]++;
      }
    }
    if (t._r != null) {
      const i = bucketIndex(buckets, t._r);
      if (i >= 0) trend[i].resolved++;
    }
  }
  // Backlog at bucket end = created before end and not yet finished at end.
  const ends = buckets.map((b) => Math.min(b.end, now));
  for (const t of rows) {
    if (t._c == null) continue;
    const finish = t._r ?? t._x ?? (TERMINAL.includes(t.status) ? parseMs(t.updated_at) : null);
    for (let i = 0; i < ends.length; i++) {
      if (t._c < ends[i] && (finish == null || finish >= ends[i])) trend[i].backlog++;
    }
  }

  const created = cur._created;
  const resolved = cur._resolved;
  const countBy = (list, keyFn) => {
    const m = new Map();
    for (const t of list) {
      const k = keyFn(t);
      if (k == null || k === "") continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const topList = (m, n, extra = () => ({})) => {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    const head = sorted.slice(0, n).map(([k, v]) => ({ key: k, value: v, ...extra(k) }));
    const rest = sorted.slice(n).reduce((a, [, v]) => a + v, 0);
    if (rest) head.push({ key: "__other", label: `Other (${sorted.length - n})`, value: rest, other: true });
    return head;
  };

  // Stage / status of tickets created in the range (current state).
  const stages = STATUS_GROUPS.map((g) => ({ key: g, value: created.filter((t) => statusGroup(t.status) === g).length }));
  const statusMap = countBy(created, (t) => t.status);
  const statuses = STATUSES.filter((s) => statusMap.has(s)).map((s) => ({ key: s, value: statusMap.get(s) }));

  const catMap = countBy(created, (t) => (t.category ? `${t.department || ""}||${t.category}` : null));
  const categories = topList(catMap, 10, (k) => {
    const [department, category] = k.split("||");
    return { label: category, department, category };
  });

  const outletMap = countBy(created, (t) => t.outlet_code);
  const outlets = topList(outletMap, 10);
  const brandMap = countBy(created, (t) => t.brand_code);
  const brands = topList(brandMap, 8);
  const regions = [...countBy(created, (t) => t.region).entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  const departments = DEPARTMENTS.map((d) => ({ key: d, value: created.filter((t) => t.department === d).length }));
  const sources = [
    { key: "authenticated", label: "Staff / requestor", value: created.filter((t) => t.source !== "public_quick_report").length },
    { key: "public_quick_report", label: "Public quick report", value: created.filter((t) => t.source === "public_quick_report").length },
  ];
  const urgencies = URGENCIES.slice().reverse().map((u) => ({ key: u, value: created.filter((t) => t.urgency === u).length }));

  // Technicians: tickets they are Primary on, created in range.
  const techs = new Map();
  for (const t of created) {
    const id = t.assigned_technician_id || 0;
    if (!techs.has(id)) techs.set(id, { key: id ? String(id) : "none", label: id ? t.assignee_name || `#${id}` : "Unassigned", assigned: 0, resolved: 0, open: 0, cancelled: 0, breached: 0, _res: [] });
    const g = techs.get(id);
    g.assigned++;
    if (DONE.includes(t.status)) { g.resolved++; if (t._e.resolution_mins != null) g._res.push(t._e.resolution_mins); }
    else if (t.status === "Cancelled") g.cancelled++;
    else g.open++;
    if (t._e.sla_status === "Breached") g.breached++;
  }
  const technicians = [...techs.values()]
    .map((g) => ({
      key: g.key, label: g.label, assigned: g.assigned, resolved: g.resolved, open: g.open, cancelled: g.cancelled,
      sla_breached: g.breached, avg_resolution_hours: g._res.length ? round1(avg(g._res) / 60) : null,
    }))
    .sort((a, b) => b.assigned - a.assigned || a.label.localeCompare(b.label));

  // SLA by urgency (resolved in range).
  const slaByUrgency = URGENCIES.slice().reverse().map((u) => {
    const l = resolved.filter((t) => t.urgency === u);
    const met = l.filter((t) => t._e.sla_status === "Met").length;
    const breached = l.filter((t) => t._e.sla_status === "Breached").length;
    return { key: u, target_minutes: targets[u], met, breached, pct: met + breached ? round1((met / (met + breached)) * 100) : null };
  });

  // When do tickets arrive? weekday × hour (local).
  const heat = WEEKDAYS.map(() => Array(24).fill(0));
  for (const t of created) {
    const d = new Date(t._c);
    heat[(d.getDay() + 6) % 7][d.getHours()]++;
  }

  // Resolution time distribution (resolved in range).
  const resDist = RES_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: 0 }));
  for (const t of resolved) {
    const m = t._e.resolution_mins;
    if (m == null || m < 0) continue;
    resDist[RES_BUCKETS.findIndex((b) => m < b.max)].value++;
  }

  // Aging of the current backlog.
  const aging = [
    { key: "lt1d", label: "< 1 day", max: 1440 },
    { key: "1to3d", label: "1–3 days", max: 4320 },
    { key: "3to7d", label: "3–7 days", max: 10080 },
    { key: "7to30d", label: "7–30 days", max: 43200 },
    { key: "gt30d", label: "> 30 days", max: Infinity },
  ].map((b) => ({ key: b.key, label: b.label, max: b.max, value: 0 }));
  for (const t of open) {
    const m = t._e.aging_minutes || 0;
    aging[aging.findIndex((b) => m < b.max)].value++;
  }

  // Personal numbers for technicians (kept from the old dashboard).
  let mine = null;
  if (isTechnician(user)) {
    const my = rows.filter((t) => t.assigned_technician_id === user.id);
    const myOpen = my.filter((t) => !TERMINAL.includes(t.status));
    mine = {
      open: myOpen.length,
      on_progress: myOpen.filter((t) => t.status === "On Progress").length,
      waiting: myOpen.filter((t) => WAITING_STATUSES.includes(t.status)).length,
      overdue: myOpen.filter((t) => t._e.sla_status === "Breached").length,
      resolved_in_range: my.filter((t) => t._r != null && t._r >= start && t._r < endExcl).length,
    };
  }

  const detail = created.map((t) => ({
    id: t.id,
    ticket_number: t.ticket_number,
    title: t.title,
    status: t.status,
    stage: statusGroup(t.status),
    urgency: t.urgency,
    department: t.department,
    category: t.category,
    brand_code: t.brand_code,
    outlet_code: t.outlet_code,
    region: t.region,
    source: t.source,
    assignee_name: t.assigned_technician_id ? t.assignee_name : null,
    customer_name: t.customer_name,
    created_at: t.created_at,
    first_response_at: t.first_response_at,
    started_at: t.started_at,
    resolved_at: t._r != null ? new Date(t._r).toISOString() : null,
    sla_status: t._e.sla_status,
    sla_deadline_at: t._e.sla_deadline_at,
    first_response_mins: t._e.first_response_mins,
    resolution_mins: t._e.resolution_mins,
    aging_minutes: t._e.aging_minutes,
    breach_minutes: t._e.breach_minutes,
  }));

  return {
    generated_at: new Date(now).toISOString(),
    filters: f,
    granularity: gran,
    kpis,
    trend,
    stages,
    statuses,
    categories,
    outlets,
    brands,
    regions,
    departments,
    sources,
    urgencies,
    technicians,
    sla_by_urgency: slaByUrgency,
    heatmap: { rows: WEEKDAYS, cols: Array.from({ length: 24 }, (_, h) => pad2(h)), values: heat },
    resolution_distribution: resDist,
    aging,
    sla_targets: targets,
    mine,
    detail,
  };
}

function optionsFrom(opt) {
  const uniq = (arr) => [...new Set(arr.filter((x) => x != null && x !== ""))].sort((a, b) => String(a).localeCompare(String(b)));
  const tech = new Map();
  for (const o of opt) if (o.assigned_technician_id) tech.set(o.assigned_technician_id, o.assignee_name || `#${o.assigned_technician_id}`);
  const cats = new Map();
  for (const o of opt) if (o.category) cats.set(`${o.department}||${o.category}`, { value: o.category, department: o.department });
  return {
    departments: uniq(opt.map((o) => o.department)).filter((d) => DEPARTMENTS.includes(d)),
    regions: uniq(opt.map((o) => o.region)),
    brands: uniq(opt.map((o) => o.brand_code)),
    outlets: uniq(opt.map((o) => o.outlet_code)),
    categories: [...cats.values()].sort((a, b) => a.value.localeCompare(b.value)),
    technicians: [...tech.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function compute(req) {
  const { filters, error } = readFilters(req.query || {});
  if (error) return { error };
  const [{ rows, opt }, targets] = await Promise.all([loadRows(req.user, filters), getSlaTargets()]);
  const data = aggregate(rows, filters, targets, req.user);
  data.options = optionsFrom(opt);
  return { data };
}

router.get("/api/analytics", requireAuth, async (req, res) => {
  try {
    const { data, error } = await compute(req);
    if (error) return res.status(400).json({ error });
    // The UI table shows the newest rows; the export carries all of them.
    const total = data.detail.length;
    data.detail_total = total;
    data.detail = data.detail.slice(0, 500);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to build analytics" });
  }
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const DETAIL_COLUMNS = [
  { header: "Ticket", key: "ticket_number", width: 16 },
  { header: "Subject", key: "title", width: 40 },
  { header: "Status", key: "status", width: 16 },
  { header: "Stage", key: "stage", width: 12 },
  { header: "Urgency", key: "urgency", width: 10 },
  { header: "Department", key: "department", width: 11 },
  { header: "Category", key: "category", width: 20 },
  { header: "Brand", key: "brand_code", width: 12 },
  { header: "Outlet", key: "outlet_code", width: 12 },
  { header: "Region", key: "region", width: 12 },
  { header: "Source", key: (r) => (r.source === "public_quick_report" ? "Public quick report" : "Staff / requestor"), width: 18 },
  { header: "Primary technician", key: (r) => r.assignee_name || "Unassigned", width: 20 },
  { header: "Requester", key: "customer_name", width: 20 },
  { header: "Created", key: "created_at", type: "datetime", width: 17 },
  { header: "First response", key: "first_response_at", type: "datetime", width: 17 },
  { header: "Work started", key: "started_at", type: "datetime", width: 17 },
  { header: "Resolved", key: "resolved_at", type: "datetime", width: 17 },
  { header: "SLA status", key: "sla_status", width: 12 },
  { header: "SLA deadline", key: "sla_deadline_at", type: "datetime", width: 17 },
  { header: "First response (min)", key: "first_response_mins", type: "int", width: 12 },
  { header: "Resolution (hours)", key: (r) => (r.resolution_mins == null ? null : round1(r.resolution_mins / 60)), type: "number", width: 12 },
  { header: "Age (hours)", key: (r) => (r.aging_minutes == null ? null : round1(r.aging_minutes / 60)), type: "number", width: 11 },
  { header: "SLA breach (hours)", key: (r) => (r.breach_minutes ? round1(r.breach_minutes / 60) : null), type: "number", width: 12 },
];

function filterSummary(f, data) {
  const tech = f.technician === "none" ? "Unassigned"
    : f.technician ? (data.options.technicians.find((t) => t.id === f.technician) || {}).name || `#${f.technician}` : "";
  return [
    ["Period", `${f.from} → ${f.to}`],
    ["Department", f.department],
    ["Region", f.region],
    ["Brand", f.brand],
    ["Outlet", f.outlet],
    ["Category", f.category],
    ["Urgency", f.urgency],
    ["Technician", tech],
    ["Stage", f.stage],
    ["Source", f.source],
  ].filter(([, v]) => v);
}

function buildWorkbook(data, user) {
  const f = data.filters;
  const k = data.kpis;
  const pct = (v) => (v == null ? null : v / 100);
  const sub = `Generated ${new Date(data.generated_at).toLocaleString()} by ${user.username} · ${filterSummary(f, data).map(([a, b]) => `${a}: ${b}`).join(" · ")}`;
  const metric = (label, value, previous, type = "number") => ({ label, value, previous, type });
  const summaryRows = [
    metric("Tickets created", k.created, k.prev.created, "int"),
    metric("Tickets resolved", k.resolved, k.prev.resolved, "int"),
    metric("Resolution rate (created & now resolved)", pct(k.resolution_rate), pct(k.prev.resolution_rate), "percent"),
    metric("SLA achievement (resolved in period)", pct(k.sla_pct), pct(k.prev.sla_pct), "percent"),
    metric("SLA met", k.sla_met, null, "int"),
    metric("SLA breached", k.sla_breached, null, "int"),
    metric("Mean time to resolve (hours)", k.mttr_hours, k.prev.mttr_hours),
    metric("Median time to resolve (hours)", k.median_resolution_hours, null),
    metric("Avg first response (minutes)", k.first_response_mins, k.prev.first_response_mins, "int"),
    metric("Open backlog (now)", k.backlog_now, null, "int"),
    metric("Unassigned (now)", k.unassigned_now, null, "int"),
    metric("Overdue vs SLA (now)", k.overdue_now, null, "int"),
    metric("At risk (now)", k.at_risk_now, null, "int"),
    metric("Critical open (now)", k.critical_now, null, "int"),
    metric("Waiting on parts / vendor / outlet (now)", k.waiting_now, null, "int"),
  ];
  const summary = {
    name: "Summary",
    title: `IT ticket analytics, ${f.from} to ${f.to}`,
    subtitle: sub,
    freeze: false,
    columns: [
      { header: "Metric", key: "label", width: 44 },
      { header: "This period", key: "value", type: "typed", width: 14 },
      { header: "Previous period", key: "previous", type: "typed", width: 16 },
    ],
    rows: summaryRows,
  };

  const g = data.granularity;
  const periodHeader = g === "day" ? "Day" : g === "week" ? "Week starting" : "Month";
  const sheets = [
    summary,
    {
      name: "Trend",
      title: `Volume by ${g}`,
      columns: [
        { header: periodHeader, key: "key", width: 14 },
        { header: "Created", key: "created", type: "int" },
        { header: "Resolved", key: "resolved", type: "int" },
        { header: "Open backlog at end", key: "backlog", type: "int", width: 20 },
        { header: "Created (IT)", key: "IT", type: "int", width: 14 },
        { header: "Created (ME)", key: "ME", type: "int", width: 14 },
      ],
      rows: data.trend,
    },
    {
      name: "Stages & status",
      title: "Tickets created in period, by current status",
      columns: [
        { header: "Status", key: "key", width: 26 },
        { header: "Stage", key: (r) => r.stage || "", width: 14 },
        { header: "Tickets", key: "value", type: "int" },
      ],
      rows: data.statuses.map((s) => ({ ...s, stage: STATUS_GROUPS.find((gg) => statusGroup(s.key) === gg) })),
    },
    {
      name: "Categories",
      title: "Tickets created by category",
      columns: [
        { header: "Department", key: (r) => r.department || "", width: 12 },
        { header: "Category", key: (r) => r.label || r.key, width: 28 },
        { header: "Tickets", key: "value", type: "int" },
      ],
      rows: data.categories,
    },
    {
      name: "Outlets",
      title: "Tickets created by outlet",
      columns: [{ header: "Outlet", key: (r) => r.label || r.key, width: 20 }, { header: "Tickets", key: "value", type: "int" }],
      rows: data.outlets,
    },
    {
      name: "Brands & regions",
      title: "Tickets created by brand, region, department and source",
      columns: [
        { header: "Dimension", key: "dim", width: 14 },
        { header: "Value", key: "label", width: 24 },
        { header: "Tickets", key: "value", type: "int" },
      ],
      rows: [
        ...data.brands.map((r) => ({ dim: "Brand", label: r.label || r.key, value: r.value })),
        ...data.regions.map((r) => ({ dim: "Region", label: r.key, value: r.value })),
        ...data.departments.map((r) => ({ dim: "Department", label: r.key, value: r.value })),
        ...data.sources.map((r) => ({ dim: "Source", label: r.label, value: r.value })),
        ...data.urgencies.map((r) => ({ dim: "Urgency", label: r.key, value: r.value })),
      ],
    },
    {
      name: "Technicians",
      title: "Technician performance (Primary / PIC on tickets created in period)",
      columns: [
        { header: "Technician", key: "label", width: 24 },
        { header: "Assigned", key: "assigned", type: "int" },
        { header: "Resolved", key: "resolved", type: "int" },
        { header: "Still open", key: "open", type: "int" },
        { header: "Cancelled", key: "cancelled", type: "int" },
        { header: "SLA breached", key: "sla_breached", type: "int", width: 13 },
        { header: "Resolution rate", key: (r) => (r.assigned ? r.resolved / r.assigned : null), type: "percent", width: 15 },
        { header: "Avg resolution (hours)", key: "avg_resolution_hours", type: "number", width: 20 },
      ],
      rows: data.technicians,
    },
    {
      name: "SLA by urgency",
      title: "SLA on tickets resolved in period",
      columns: [
        { header: "Urgency", key: "key" },
        { header: "Target (hours)", key: (r) => round1(r.target_minutes / 60), type: "number", width: 14 },
        { header: "Met", key: "met", type: "int" },
        { header: "Breached", key: "breached", type: "int" },
        { header: "Achievement", key: (r) => (r.pct == null ? null : r.pct / 100), type: "percent", width: 13 },
      ],
      rows: data.sla_by_urgency,
    },
    {
      name: "Resolution time",
      title: "How long resolved tickets took",
      columns: [{ header: "Time to resolve", key: "label", width: 18 }, { header: "Tickets", key: "value", type: "int" }],
      rows: data.resolution_distribution,
    },
    {
      name: "Backlog age",
      title: "Age of currently open tickets",
      columns: [{ header: "Age", key: "label", width: 14 }, { header: "Open tickets", key: "value", type: "int", width: 13 }],
      rows: data.aging,
    },
    {
      name: "Arrival heatmap",
      title: "Tickets created by weekday and hour",
      columns: [{ header: "Weekday", key: "day" }, ...data.heatmap.cols.map((h, i) => ({ header: `${h}:00`, key: (r) => r.values[i], type: "int", width: 7 }))],
      rows: data.heatmap.rows.map((day, i) => ({ day, values: data.heatmap.values[i] })),
    },
    {
      name: "Tickets",
      title: `Tickets created ${f.from} → ${f.to}`,
      columns: DETAIL_COLUMNS,
      rows: data.detail,
    },
    {
      name: "Filters",
      freeze: false,
      columns: [{ header: "Filter", key: 0, width: 16 }, { header: "Value", key: 1, width: 40 }],
      rows: filterSummary(f, data).map(([a, b]) => ({ 0: a, 1: b })),
    },
  ];
  return sheets;
}

router.get("/api/analytics/export", requireAuth, async (req, res) => {
  try {
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    const { data, error } = await compute(req);
    if (error) return res.status(400).json({ error });
    const f = data.filters;
    const base = `itme_analytics_${f.from}_to_${f.to}`;
    // SLA is IT-side only: requestors get their export without it.
    const hideSla = req.user.role === "Requestor";
    const noSla = (c) => !hideSla || !/SLA/.test(c.header);
    if (format === "csv") {
      const cols = DETAIL_COLUMNS.filter(noSla);
      const headers = cols.map((c) => c.header);
      const records = data.detail.map((r) => {
        const o = {};
        for (const c of cols) o[c.header] = typeof c.key === "function" ? c.key(r) : r[c.key];
        return o;
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.csv"`);
      return res.send("﻿" + toCsv(headers, records));
    }
    let sheets = buildWorkbook(data, req.user);
    if (hideSla) {
      sheets = sheets
        .filter((s) => s.name !== "SLA by urgency")
        .map((s) => ({
          ...s,
          columns: s.columns.filter(noSla),
          rows: s.name === "Summary" ? s.rows.filter((r) => !/SLA/.test(r.label)) : s.rows,
        }));
    }
    const buf = buildXlsx(sheets, { title: `IT analytics ${f.from} to ${f.to}` });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`);
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to export analytics" });
  }
});

module.exports = router;
module.exports._internal = { readFilters, bucketsFor, aggregate };
