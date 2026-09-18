/* ==========================================================================
   Service — Tickets
   getVisibleTicket(): returns the ticket row with the given id ONLY if it
   passes the caller's scope clause (buildTicketScope), otherwise undefined.
   toClientTicket(): strips internal-only columns before a row leaves the API.
   ========================================================================== */
const db = require("../../database");
const { buildTicketScope } = require("../utils/permissions");

// fetch a ticket the user is allowed to see, or undefined.
// opts is forwarded to buildTicketScope (e.g. { techFilter: 'all' } to check a
// ticket against a technician's broadest allowed scope).
async function getVisibleTicket(user, id, opts = {}) {
  const ticketId = Number.parseInt(id, 10);
  if (!Number.isInteger(ticketId) || ticketId < 1) return undefined;
  const scope = await buildTicketScope(user, opts);
  return db.pGet(`SELECT * FROM tickets WHERE id = ? AND ${scope.clause}`, [
    ticketId,
    ...scope.params,
  ]);
}

const INTERNAL_COLUMNS = ["tracking_token_hash", "tracking_token_created_at"];
function toClientTicket(t) {
  if (!t) return t;
  const out = { ...t };
  for (const c of INTERNAL_COLUMNS) delete out[c];
  return out;
}

module.exports = { getVisibleTicket, toClientTicket };
