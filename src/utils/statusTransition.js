/* ==========================================================================
   Util — ticket status transition validation
   Pure function (no db). Returns an error string if the requested transition
   is not allowed, or null if it is valid.

   The status model has two layers (see config/constants):
     • core     New → Open → On Progress → Closed  (simplified daily flow)
     • extended Assigned / On Scheduled / Waiting Sparepart / Waiting Vendor /
                Pending Outlet Response / Escalated / Resolved / Cancelled
   Both layers are valid values of the single tickets.status column. The rules
   below wire the extended states back into the core flow rather than removing
   them — e.g. Open → On Scheduled → On Progress for scheduled event work.

   Guards kept unchanged:
     - status must be a known status (ALL_STATUSES)
     - Resolved/Closed require a resolution note (from body or existing ticket)
     - Cancelled requires a cancel reason
     - On Progress requires an assigned technician (admins exempt)
     - reopening a Closed ticket requires an admin + a reason
   ========================================================================== */
const { ALL_STATUSES } = require("../config/constants");
const { isAdmin } = require("./permissions");

// Allowed next statuses per current status. A ticket must pass through
// On Progress before it can reach Resolved/Closed — that is the one hard rule
// of the core flow. Everything else stays deliberately permissive so real
// operational paths (scheduling, waiting, escalation) are never blocked.
const ALLOWED_TRANSITIONS = {
  New: ["Open", "Assigned", "On Scheduled", "On Progress", "Escalated", "Cancelled"],
  Open: [
    "Assigned",
    "On Scheduled",
    "On Progress",
    "Waiting Sparepart",
    "Waiting Vendor",
    "Pending Outlet Response",
    "Escalated",
    "Cancelled",
  ],
  Assigned: [
    "Open",
    "On Scheduled",
    "On Progress",
    "Waiting Sparepart",
    "Waiting Vendor",
    "Pending Outlet Response",
    "Escalated",
    "Cancelled",
  ],
  "On Scheduled": [
    "Open",
    "Assigned",
    "On Progress",
    "Waiting Sparepart",
    "Waiting Vendor",
    "Pending Outlet Response",
    "Escalated",
    "Cancelled",
  ],
  "On Progress": [
    // back to the queue / re-plan — allowed, and still cannot skip to Closed
    "Open",
    "Assigned",
    "On Scheduled",
    "Waiting Sparepart",
    "Waiting Vendor",
    "Pending Outlet Response",
    "Escalated",
    "Resolved",
    "Closed",
    "Cancelled",
  ],
  "Waiting Sparepart": [
    "On Progress",
    "On Scheduled",
    "Escalated",
    "Resolved",
    "Cancelled",
  ],
  "Waiting Vendor": [
    "On Progress",
    "On Scheduled",
    "Escalated",
    "Resolved",
    "Cancelled",
  ],
  "Pending Outlet Response": [
    "On Progress",
    "On Scheduled",
    "Escalated",
    "Resolved",
    "Cancelled",
  ],
  Escalated: [
    "On Progress",
    "On Scheduled",
    "Waiting Sparepart",
    "Waiting Vendor",
    "Pending Outlet Response",
    "Resolved",
    "Cancelled",
  ],
  Resolved: ["Closed", "On Progress", "Escalated", "Cancelled"],
  // Reopen — additionally gated below on admin + reason.
  Closed: ["Open", "On Progress"],
  Cancelled: ["Open", "New"],
};

// Is `next` reachable from `current`? Unknown/legacy current values are treated
// permissively so historical tickets can always be moved forward.
function canTransition(current, next) {
  if (current === next) return true;
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed) return true;
  return allowed.includes(next);
}

/**
 * validateTransition(ticket, next, body, user, opts)
 *
 * opts.isTeamMember — the actor is on the ticket's assignment team (Primary/PIC
 *   or Collaborator). A collaborator counts as "a technician is on this job",
 *   so they can start work even on a ticket whose PIC column is empty.
 */
function validateTransition(ticket, next, body, user, opts = {}) {
  if (!ALL_STATUSES.includes(next)) return "Invalid status value";
  if (
    next === "Resolved" &&
    !(body.resolution_note || ticket.resolution_note)
  ) {
    return "A resolution note describing the action taken is required to mark Resolved";
  }
  if (next === "Closed" && !(body.resolution_note || ticket.resolution_note)) {
    return "A resolution note is required before closing";
  }
  if (next === "Cancelled" && !body.cancel_reason) {
    return "A cancellation reason is required";
  }
  // Cancelling is an admin action (with a reason) on any non-closed ticket.
  if (next === "Cancelled" && !isAdmin(user)) {
    return "Only an admin can cancel a ticket";
  }
  // Core flow: work must be started before it can be resolved/closed — direct
  // New→Closed / Open→Closed is not allowed.
  if (
    (next === "Closed" || next === "Resolved") &&
    ["New", "Open", "Assigned", "On Scheduled"].includes(ticket.status)
  ) {
    return next === "Closed"
      ? "Move ticket to On Progress before closing."
      : "Move ticket to On Progress before marking it Resolved.";
  }
  // Starting work needs somebody on the job: the PIC column, a team member
  // (Primary or Collaborator), or an admin starting it themselves.
  if (
    next === "On Progress" &&
    !ticket.assigned_technician_id &&
    !opts.isTeamMember &&
    !isAdmin(user)
  ) {
    return "Assign a technician before starting work";
  }
  if (ticket.status === "Closed" && next !== "Closed") {
    // reopening
    if (!isAdmin(user)) return "Only an admin can reopen a closed ticket";
    if (!body.reopen_reason && !body.reason)
      return "A reason is required to reopen a closed ticket";
  }
  if (ticket.status === "Cancelled" && next !== "Cancelled") {
    // un-cancelling is the same class of action as reopening
    if (!isAdmin(user)) return "Only an admin can reopen a cancelled ticket";
    if (!body.reopen_reason && !body.reason)
      return "A reason is required to reopen a cancelled ticket";
  }
  if (!canTransition(ticket.status, next)) {
    return `Cannot move a ticket from ${ticket.status} to ${next}`;
  }
  return null;
}

module.exports = { validateTransition, canTransition, ALLOWED_TRANSITIONS };
