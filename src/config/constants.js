/* ==========================================================================
   Config — domain constants
   ========================================================================== */
/* --------------------------------------------------------------------------
   Status model — two layers over ONE `tickets.status` column.

   • CORE_STATUSES     the simplified daily workflow (New → Open → On Progress
                       → Closed). This is what technicians see by default and
                       what the dashboard cards are grouped into.
   • EXTENDED_STATUSES operational/detail states kept for admin handling,
                       scheduled event work (On Scheduled → printer/POS setup),
                       sparepart/vendor waits, escalation, SLA/KPI reporting and
                       historical tickets. They are NOT deprecated.
   • ALL_STATUSES      everything the backend accepts and the DB may contain.

   The core list is a *view* of the model, never a replacement for it: any
   status in ALL_STATUSES is valid to store, filter, report and export.
   -------------------------------------------------------------------------- */
const CORE_STATUSES = ["New", "Open", "On Progress", "Closed"];
const EXTENDED_STATUSES = [
  "Assigned",
  "On Scheduled",
  "Waiting Sparepart",
  "Waiting Vendor",
  "Pending Outlet Response",
  "Escalated",
  "Resolved",
  "Cancelled",
];
const ALL_STATUSES = [...CORE_STATUSES, ...EXTENDED_STATUSES];

// STATUSES — the same set as ALL_STATUSES, kept in workflow order for filter
// dropdowns, reports and exports. Retained under its original name because it
// is the long-standing public constant used across routes/UI.
const STATUSES = [
  "New",
  "Open",
  "Assigned",
  "On Scheduled",
  "On Progress",
  "Waiting Sparepart",
  "Waiting Vendor",
  "Pending Outlet Response",
  "Escalated",
  "Resolved",
  "Closed",
  "Cancelled",
];

/* --------------------------------------------------------------------------
   TECHNICIAN_STATUSES — what an assigned technician (Primary/PIC OR
   Collaborator) may set themselves.

   Technicians are on site and usually know the real field condition before
   admin does, so they own the whole operational middle of the flow, not just
   the 4 core statuses. Two statuses are deliberately NOT here:
     • "New"       — system-set only, never chosen by hand
     • "Cancelled" — admin-only, and requires a reason
   Reopening a Closed/Cancelled ticket also stays admin-only (also with a
   reason). Everything else is still subject to the transition rules in
   utils/statusTransition (e.g. New/Open → Closed remains blocked).
   -------------------------------------------------------------------------- */
const TECHNICIAN_STATUSES = [
  "Open",
  "On Progress",
  "On Scheduled",
  "Waiting Sparepart",
  "Waiting Vendor",
  "Pending Outlet Response",
  "Escalated",
  "Resolved",
  "Closed",
];

// Statuses that mean "work is parked, waiting on someone else". A short note
// explaining what is being waited for is expected (soft-required) on these.
const WAITING_STATUSES = [
  "Waiting Sparepart",
  "Waiting Vendor",
  "Pending Outlet Response",
];

// Terminal states: no further work happens unless an admin reopens.
const TERMINAL_STATUSES = ["Closed", "Cancelled"];

/* --------------------------------------------------------------------------
   Status grouping — for dashboard cards and summary reporting ONLY.
   Grouping never rewrites a ticket's stored status; it is a read-side rollup.
   -------------------------------------------------------------------------- */
const STATUS_GROUPS = ["New", "Open", "On Progress", "Closed", "Cancelled"];
const STATUS_GROUP_OF = {
  New: "New",
  Open: "Open",
  Assigned: "Open",
  "On Scheduled": "Open",
  "Waiting Sparepart": "Open",
  "Waiting Vendor": "Open",
  "Pending Outlet Response": "Open",
  Escalated: "Open",
  "On Progress": "On Progress",
  Resolved: "Closed",
  Closed: "Closed",
  Cancelled: "Cancelled",
};
// Unknown/legacy values fall into "Open" so nothing silently disappears from
// the dashboard; the actual status is still shown everywhere it matters.
const statusGroup = (s) => STATUS_GROUP_OF[s] || "Open";
const statusesInGroup = (g) => STATUSES.filter((s) => statusGroup(s) === g);
const URGENCIES = ["Low", "Medium", "High", "Critical"];
const DEPARTMENTS = ["IT", "ME"];
const ADMIN_ROLES = ["SuperAdmin", "AdminIT", "AdminME"];
const REGIONS = ["Jakarta", "Surabaya"];

// Default SLA resolution targets (minutes) by urgency. Configurable later via
// app_settings (key: sla_targets). Kept in one place so it isn't hard-coded
// across the codebase.
const SLA_TARGET_MINUTES = {
  Critical: 2 * 60, //   2 hours
  High: 4 * 60, //       4 hours
  Medium: 24 * 60, //    1 day
  Low: 3 * 24 * 60, //   3 days
};

module.exports = {
  STATUSES,
  ALL_STATUSES,
  CORE_STATUSES,
  EXTENDED_STATUSES,
  TECHNICIAN_STATUSES,
  WAITING_STATUSES,
  TERMINAL_STATUSES,
  STATUS_GROUPS,
  STATUS_GROUP_OF,
  statusGroup,
  statusesInGroup,
  URGENCIES,
  DEPARTMENTS,
  ADMIN_ROLES,
  REGIONS,
  SLA_TARGET_MINUTES,
};
