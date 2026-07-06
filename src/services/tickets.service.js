/* ==========================================================================
   Service — Tickets
   Verbatim move of getVisibleTicket() from app.js. Behavior unchanged:
   returns the ticket row with the given id ONLY if it passes the caller's
   scope clause (buildTicketScope), otherwise undefined/null — enforcing
   per-user ticket visibility.
   ========================================================================== */
const db = require("../../database");
const { buildTicketScope } = require("../utils/permissions");

// fetch a ticket the user is allowed to see, or null
async function getVisibleTicket(user, id) {
  const scope = await buildTicketScope(user);
  return db.pGet(`SELECT * FROM tickets WHERE id = ? AND ${scope.clause}`, [
    id,
    ...scope.params,
  ]);
}

module.exports = { getVisibleTicket };
