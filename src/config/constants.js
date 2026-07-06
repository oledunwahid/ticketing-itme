/* ==========================================================================
   Config — domain constants
   Verbatim move of the constant arrays previously defined inline in app.js.
   Values are unchanged.
   ========================================================================== */
const STATUSES = [
  "New",
  "Open",
  "Assigned",
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

module.exports = {
  STATUSES,
  URGENCIES,
  DEPARTMENTS,
  ADMIN_ROLES,
};
