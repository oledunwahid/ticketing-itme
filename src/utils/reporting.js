/* ==========================================================================
   Utils — Reporting & Managerial Performance helpers
   Pure(ish) helpers for the Reporting & Performance module:
     • getSlaTargets()   — configurable SLA resolution targets (DB-overridable)
     • enrichTicket()    — attach computed SLA / timing / aging fields to a row
     • summarize()       — executive summary + department/outlet/region rollups
     • buildInsights()   — rule-based "Manager Insights" narrative
   SLA targets are NOT hard-coded here — defaults live in config/constants and
   can be overridden via app_settings(key='sla_targets') as JSON.
   ========================================================================== */
const db = require("../../database");
const { SLA_TARGET_MINUTES, STATUSES } = require("../config/constants");

const OPEN_STATUSES = STATUSES.filter(
  (s) => !["Resolved", "Closed", "Cancelled"].includes(s),
);
const BACKLOG_STATUSES = STATUSES.filter(
  (s) => !["Closed", "Cancelled"].includes(s),
);

// Parse a SQLite datetime ('YYYY-MM-DD HH:MM:SS', stored UTC) → epoch ms | null.
function ms(s) {
  if (!s) return null;
  let v = String(s).trim();
  if (!v) return null;
  if (!v.includes("T")) v = v.replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(v)) v += "Z";
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}
// minutes between two epoch-ms values (rounded), or null if either missing.
function minsBetween(a, b) {
  if (a == null || b == null) return null;
  return Math.round((b - a) / 60000);
}
function isoOf(msVal) {
  return msVal == null ? null : new Date(msVal).toISOString();
}

// Configurable SLA targets. Reads app_settings('sla_targets') JSON if present,
// merged over the built-in defaults; falls back to defaults on any error.
async function getSlaTargets() {
  const targets = { ...SLA_TARGET_MINUTES };
  try {
    const row = await db.pGet(
      "SELECT value FROM app_settings WHERE key = 'sla_targets'",
    );
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      for (const k of Object.keys(targets)) {
        if (parsed[k] != null && Number.isFinite(Number(parsed[k])))
          targets[k] = Number(parsed[k]);
      }
    }
  } catch (_) {
    /* keep defaults */
  }
  return targets;
}

function targetFor(targets, urgency) {
  return targets[urgency] || targets.Medium || SLA_TARGET_MINUTES.Medium;
}

// Attach computed timing + SLA fields to a ticket row (does not mutate input).
// nowMs lets callers pin "now" consistently across a whole report.
function enrichTicket(t, targets, nowMs = Date.now()) {
  const created = ms(t.created_at);
  const firstResp = ms(t.first_response_at);
  const assigned = ms(t.assigned_at);
  const started = ms(t.started_at);
  const resolved = ms(t.resolved_at);
  const closed = ms(t.closed_at);
  const endpoint = resolved != null ? resolved : closed; // resolution endpoint

  const targetMins = targetFor(targets, t.urgency);
  const deadline = created != null ? created + targetMins * 60000 : null;

  const first_response_mins = minsBetween(created, firstResp);
  const assign_mins = minsBetween(created, assigned);
  const start_mins = minsBetween(created, started);
  const resolution_mins = minsBetween(created, endpoint);
  const close_mins = minsBetween(resolved != null ? resolved : created, closed);

  // SLA status: Met / Breached / At Risk / Not Started / On Track / N/A
  let sla_status = "On Track";
  let breach_minutes = 0;
  if (t.status === "Cancelled") {
    sla_status = "N/A";
  } else if (endpoint != null && deadline != null) {
    if (endpoint <= deadline) sla_status = "Met";
    else {
      sla_status = "Breached";
      breach_minutes = Math.round((endpoint - deadline) / 60000);
    }
  } else if (deadline != null && nowMs > deadline) {
    sla_status = "Breached";
    breach_minutes = Math.round((nowMs - deadline) / 60000);
  } else if (started == null && assigned == null) {
    sla_status = "Not Started";
  } else if (deadline != null && nowMs >= created + targetMins * 60000 * 0.75) {
    sla_status = "At Risk";
  } else {
    sla_status = "On Track";
  }

  const endForAging = endpoint != null ? endpoint : nowMs;
  const aging_minutes = created != null ? Math.round((endForAging - created) / 60000) : null;

  return {
    ...t,
    sla_target_minutes: targetMins,
    sla_deadline_at: isoOf(deadline),
    sla_status,
    breach_minutes,
    aging_minutes,
    first_response_mins,
    assign_mins,
    start_mins,
    resolution_mins,
    close_mins,
    is_open: OPEN_STATUSES.includes(t.status),
    is_backlog: BACKLOG_STATUSES.includes(t.status),
  };
}

// average of the non-null numbers in `arr`, rounded to `dp` decimals, or null.
function avg(arr, dp = 0) {
  const nums = arr.filter((n) => n != null && Number.isFinite(n));
  if (!nums.length) return null;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const f = Math.pow(10, dp);
  return Math.round(m * f) / f;
}
function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key] == null || r[key] === "" ? "—" : r[key];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// Executive summary block over an enriched row set.
function summarize(rows) {
  const byStatus = countBy(rows, "status");
  const g = (s) => byStatus[s] || 0;
  const slaMet = rows.filter((r) => r.sla_status === "Met").length;
  const slaBreached = rows.filter((r) => r.sla_status === "Breached").length;
  const slaAtRisk = rows.filter((r) => r.sla_status === "At Risk").length;
  const slaNotStarted = rows.filter((r) => r.sla_status === "Not Started").length;
  const slaTotal = slaMet + slaBreached;
  return {
    total: rows.length,
    byStatus,
    new: g("New"),
    open: rows.filter((r) => r.is_backlog).length,
    assigned: g("Assigned"),
    on_scheduled: g("On Scheduled"),
    on_progress: g("On Progress"),
    waiting_sparepart: g("Waiting Sparepart"),
    waiting_vendor: g("Waiting Vendor"),
    resolved: g("Resolved"),
    closed: g("Closed"),
    cancelled: g("Cancelled"),
    sla_met: slaMet,
    sla_breached: slaBreached,
    sla_at_risk: slaAtRisk,
    sla_not_started: slaNotStarted,
    sla_achievement:
      slaTotal > 0 ? Math.round((slaMet / slaTotal) * 1000) / 10 : null,
    avg_first_response_mins: avg(rows.map((r) => r.first_response_mins)),
    avg_assign_mins: avg(rows.map((r) => r.assign_mins)),
    avg_start_mins: avg(rows.map((r) => r.start_mins)),
    avg_resolution_mins: avg(rows.map((r) => r.resolution_mins)),
    avg_close_mins: avg(rows.map((r) => r.close_mins)),
  };
}

// Human-friendly minutes → "2h 15m" / "1d 4h" / "35m".
function fmtDuration(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(mins / (60 * 24));
  const h = Math.floor((mins % (60 * 24)) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function topEntry(obj, exclude = ["—"]) {
  let best = null;
  for (const [k, v] of Object.entries(obj)) {
    if (exclude.includes(k)) continue;
    if (!best || v > best.count) best = { key: k, count: v };
  }
  return best;
}

// Rule-based "Manager Insights" narrative. Returns { summary, bullets[] }.
// Input `agg` is the object assembled by the /performance route.
function buildInsights(agg, filters = {}) {
  const bullets = [];
  const s = agg.summary;
  const period = filters.period_label || "the selected period";
  const scopeDept = filters.department ? `${filters.department} ` : "";

  // Opening line — volume, scope, regions.
  const regionList = (agg.regions || [])
    .filter((r) => r.total > 0)
    .map((r) => r.region);
  const regionPhrase = regionList.length
    ? ` across ${regionList.join(" and ")}`
    : "";
  let summary = `During ${period}, ${scopeDept ? scopeDept + "teams" : "the teams"} handled ${s.total} ticket(s)${regionPhrase}.`;

  const topCat = (agg.categories || [])[0];
  if (topCat && topCat.total > 0) {
    summary += ` The highest ticket volume came from ${topCat.category} issues (${topCat.total}).`;
    bullets.push(
      `Most recurring category: ${topCat.department ? topCat.department + " · " : ""}${topCat.category} — ${topCat.total} ticket(s).`,
    );
  }

  const techs = agg.technicians || [];
  const mostResolved = [...techs].sort((a, b) => b.resolved - a.resolved)[0];
  const fastest = [...techs]
    .filter((t) => t.avg_resolution_mins != null && t.resolved > 0)
    .sort((a, b) => a.avg_resolution_mins - b.avg_resolution_mins)[0];
  const mostBreach = [...techs].sort((a, b) => b.sla_breached - a.sla_breached)[0];
  const highestWorkload = [...techs].sort((a, b) => b.open_workload - a.open_workload)[0];

  if (mostResolved && mostResolved.resolved > 0) {
    let line = `${mostResolved.technician} resolved the most tickets (${mostResolved.resolved})`;
    if (fastest && fastest.technician !== mostResolved.technician)
      line += `, while ${fastest.technician} had the fastest average resolution (${fmtDuration(fastest.avg_resolution_mins)})`;
    summary += ` ${line}.`;
    bullets.push(
      `Top resolver: ${mostResolved.technician} — ${mostResolved.resolved} resolved.`,
    );
  }
  if (fastest)
    bullets.push(
      `Fastest average resolution: ${fastest.technician} — ${fmtDuration(fastest.avg_resolution_mins)}.`,
    );
  if (mostBreach && mostBreach.sla_breached > 0)
    bullets.push(
      `Most SLA breaches: ${mostBreach.technician} — ${mostBreach.sla_breached} breach(es).`,
    );
  if (highestWorkload && highestWorkload.open_workload > 0)
    bullets.push(
      `Highest current workload: ${highestWorkload.technician} — ${highestWorkload.open_workload} open ticket(s).`,
    );

  if (s.sla_achievement != null) {
    summary += ` SLA achievement was ${s.sla_achievement}%`;
    // Attribute breaches to the dominant waiting bottleneck if present.
    const waitBottleneck =
      s.waiting_sparepart >= s.waiting_vendor
        ? { label: "Waiting Sparepart", n: s.waiting_sparepart }
        : { label: "Waiting Vendor", n: s.waiting_vendor };
    if (s.sla_breached > 0 && waitBottleneck.n > 0)
      summary += `, with bottlenecks often linked to ${waitBottleneck.label} status`;
    summary += ".";
  }

  const topOutlet = (agg.outlets || [])[0];
  if (topOutlet && topOutlet.total > 0) {
    bullets.push(
      `Most problematic outlet: ${topOutlet.outlet} — ${topOutlet.total} ticket(s)${topOutlet.sla_breached ? `, ${topOutlet.sla_breached} SLA breach(es)` : ""}.`,
    );
  }
  const recurring = (agg.recurring || [])[0];
  if (recurring && recurring.count > 1) {
    summary += ` ${recurring.outlet} had repeated ${recurring.category} requests (${recurring.count}).`;
  }

  // Department backlog highlight.
  const depts = agg.departments || [];
  const heavier = [...depts].sort((a, b) => b.backlog - a.backlog)[0];
  if (heavier && heavier.backlog > 0)
    bullets.push(
      `Highest backlog: ${heavier.department} — ${heavier.backlog} open ticket(s).`,
    );

  // Region highlight.
  const topRegion = [...(agg.regions || [])].sort((a, b) => b.total - a.total)[0];
  if (topRegion && topRegion.total > 0)
    bullets.push(
      `Highest ticket count by region: ${topRegion.region} — ${topRegion.total} ticket(s).`,
    );

  // Scheduled work.
  const sc = agg.scheduled || {};
  if (sc.total > 0) {
    let line = `There are ${sc.total} On Scheduled ticket(s)`;
    if (sc.this_week != null) line += `, ${sc.this_week} this week`;
    if (sc.overdue) line += `, ${sc.overdue} overdue`;
    if (sc.not_started) line += `, ${sc.not_started} not started yet`;
    summary += ` ${line}.`;
    if (sc.overdue)
      bullets.push(`Overdue scheduled work: ${sc.overdue} ticket(s) past their scheduled time.`);
    if (sc.not_assigned)
      bullets.push(`Scheduled but unassigned: ${sc.not_assigned} ticket(s).`);
  }

  // Waiting bottlenecks.
  const waitTotal = s.waiting_sparepart + s.waiting_vendor;
  if (waitTotal > 0)
    bullets.push(
      `Supply bottlenecks: ${s.waiting_sparepart} waiting sparepart, ${s.waiting_vendor} waiting vendor.`,
    );

  return { summary, bullets };
}

module.exports = {
  OPEN_STATUSES,
  BACKLOG_STATUSES,
  ms,
  minsBetween,
  getSlaTargets,
  enrichTicket,
  summarize,
  buildInsights,
  fmtDuration,
  avg,
  countBy,
  topEntry,
};
