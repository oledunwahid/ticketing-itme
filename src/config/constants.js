/* ==========================================================================
   Config — domain constants
   ========================================================================== */
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
// Core simplified daily-workflow statuses (New → Open → On Progress → Closed).
// The full STATUSES list above is retained in the DB for reporting, SLA and
// operational detail; CORE_STATUSES is only the visible/enforced daily flow.
const CORE_STATUSES = ["New", "Open", "On Progress", "Closed"];
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
  CORE_STATUSES,
  URGENCIES,
  DEPARTMENTS,
  ADMIN_ROLES,
  REGIONS,
  SLA_TARGET_MINUTES,
};
