/* ==========================================================================
   Service — Audit / activity log
   Verbatim move of logActivity() from app.js. Behavior unchanged:
   inserts one row into ticket_activity_logs; a null actor is recorded as
   "System" for name/role and null actor id.
   ========================================================================== */
const db = require("../../database");

async function logActivity(ticketId, actor, action, detail) {
  await db.pRun(
    `INSERT INTO ticket_activity_logs (ticket_id, actor_user_id, actor_name, actor_role, action, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      ticketId,
      actor ? actor.id : null,
      actor ? actor.username : "System",
      actor ? actor.role : "System",
      action,
      detail || null,
    ],
  );
}

module.exports = { logActivity };
