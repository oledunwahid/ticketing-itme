/* ==========================================================================
   Util — ticket status transition validation
   Verbatim move of validateTransition() from app.js. Pure function (no db).
   Returns an error string if the requested transition is not allowed, or
   null if it is valid. Rules are unchanged:
     - status must be a known STATUS
     - Resolved/Closed require a resolution note (from body or existing ticket)
     - Cancelled requires a cancel reason
     - On Progress requires an assigned technician
     - reopening a Closed ticket requires an admin + a reason
   ========================================================================== */
const { STATUSES } = require("../config/constants");
const { isAdmin } = require("./permissions");

function validateTransition(ticket, next, body, user) {
  if (!STATUSES.includes(next)) return "Invalid status value";
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
  if (next === "On Progress" && !ticket.assigned_technician_id) {
    return "Assign a technician before starting work";
  }
  if (ticket.status === "Closed" && next !== "Closed") {
    // reopening
    if (!isAdmin(user)) return "Only an admin can reopen a closed ticket";
    if (!body.reopen_reason && !body.reason)
      return "A reason is required to reopen a closed ticket";
  }
  return null;
}

module.exports = { validateTransition };
