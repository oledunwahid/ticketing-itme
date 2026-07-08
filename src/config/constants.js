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
  URGENCIES,
  DEPARTMENTS,
  ADMIN_ROLES,
  REGIONS,
  SLA_TARGET_MINUTES,
};
