/* ==========================================================================
   Service — ticket assignment team (Primary Technician / PIC + Collaborators)

   One place for the multi-technician rules so the admin "Manage Assignment"
   flow and the technician "Invite Collaborator" flow can never drift apart:

     • exactly one ACTIVE Primary Technician / PIC per ticket
     • any number of Collaborators
     • a technician is never assigned twice (Primary and Collaborator are
       mutually exclusive — promoting a Collaborator moves them, it does not
       duplicate them)
     • changing the Primary leaves Collaborators untouched
     • removing a Collaborator leaves the Primary untouched
     • assignment NEVER changes the ticket status
     • every change is written to the activity log in plain-language wording

   The `tickets.assigned_technician_id` / `assignee_name` columns stay in sync
   with the active Primary row — they remain the source of truth for lists,
   dashboards, scoping and reporting.
   ========================================================================== */
const db = require("../../database");
const { logActivity } = require("./auditLog.service");
const { isAdmin, isTechnician, deptForRole } = require("../utils/permissions");

const TERMINAL_STATUSES = ["Closed", "Cancelled"];

// How an actor is named in the activity log: admins are institutional
// ("Admin assigned …"), technicians speak for themselves ("T TechIT invited …").
function actorLabel(user) {
  if (!user) return "System";
  return isAdmin(user) ? "Admin" : user.username;
}

// --- Reads -----------------------------------------------------------------

// Active assignment rows for a ticket, newest first, with the technician's
// name/department attached. `role_type` defaults to 'primary' for legacy rows.
async function getActiveAssignments(ticketId) {
  const rows = await db.pAll(
    `SELECT a.*, u.username AS technician_name, u.email AS technician_email,
            u.phone AS technician_phone, u.role AS technician_role
       FROM ticket_assignments a
       LEFT JOIN users u ON u.id = a.technician_id
      WHERE a.ticket_id = ? AND (a.active = 1 OR a.is_active = 1)
      ORDER BY a.assigned_at DESC`,
    [ticketId],
  );
  return rows.map((r) => ({ ...r, role_type: r.role_type || "primary" }));
}

async function getTeam(ticketId) {
  const active = await getActiveAssignments(ticketId);
  return {
    active,
    primary: active.find((a) => a.role_type === "primary") || null,
    collaborators: active.filter((a) => a.role_type === "collaborator"),
  };
}

// Is this user on the ticket's team (either role)? Used to gate invites.
async function isTeamMember(ticketId, userId) {
  const { active } = await getTeam(ticketId);
  return active.some((a) => a.technician_id === userId);
}

// --- Validation ------------------------------------------------------------

// Load a technician row and check they can be put on this ticket at all.
// Returns { tech } or { error, status } — never throws for ordinary refusals.
async function loadAssignableTechnician(technicianId, ticket, { override = false } = {}) {
  const tech = await db.pGet(
    "SELECT id, username, email, phone, department, role, is_active FROM users WHERE id = ?",
    [technicianId],
  );
  if (!tech || !isTechnician({ role: tech.role }))
    return { error: "Not a valid technician", status: 400 };
  if (tech.is_active === 0)
    return { error: "Technician is inactive", status: 400 };
  const techDept = deptForRole(tech.role);
  if (techDept !== ticket.department && !override) {
    return {
      error: `Technician is ${techDept}, ticket is ${ticket.department}. Use override to force.`,
      status: 400,
    };
  }
  return { tech };
}

// --- Writes ----------------------------------------------------------------

const deactivate = (where, params) =>
  db.pRun(
    `UPDATE ticket_assignments SET active = 0, is_active = 0, unassigned_at = CURRENT_TIMESTAMP
      WHERE ticket_id = ? ${where} AND (active = 1 OR is_active = 1)`,
    params,
  );

// Point tickets.assigned_technician_id at the active Primary (or clear it).
// Timestamps are touched, the STATUS is deliberately not.
async function syncPrimaryColumns(ticketId, tech) {
  if (tech) {
    await db.pRun(
      `UPDATE tickets SET assigned_technician_id = ?, assignee_name = ?,
              assigned_at = COALESCE(assigned_at, CURRENT_TIMESTAMP),
              first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [tech.id, tech.username, ticketId],
    );
  } else {
    await db.pRun(
      `UPDATE tickets SET assigned_technician_id = NULL, assignee_name = 'Unassigned',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [ticketId],
    );
  }
}

/**
 * Make `tech` the Primary Technician / PIC.
 * The outgoing Primary is released; Collaborators are left alone; if `tech` was
 * a Collaborator their row is replaced so they are never listed twice.
 */
async function setPrimary(ticket, tech, actor, note) {
  const { primary } = await getTeam(ticket.id);
  const replacing = primary && primary.technician_id !== tech.id ? primary : null;

  await deactivate("AND role_type = 'primary'", [ticket.id]);
  await deactivate("AND technician_id = ?", [ticket.id, tech.id]);
  await db.pRun(
    `INSERT INTO ticket_assignments (ticket_id, technician_id, assigned_by, reason, role_type, active, is_active)
     VALUES (?, ?, ?, ?, 'primary', 1, 1)`,
    [ticket.id, tech.id, actor ? actor.id : null, note || null],
  );
  await syncPrimaryColumns(ticket.id, tech);

  const who = actorLabel(actor);
  const detail = replacing
    ? `${who} changed Primary Technician from ${replacing.technician_name} to ${tech.username}.`
    : `${who} assigned ${tech.username} as Primary Technician / PIC.`;
  await logActivity(ticket.id, actor, "ticket.assigned", withNote(detail, note));
  return { role_type: "primary", replaced: replacing };
}

/**
 * Add `tech` as a Collaborator. `via` is "invite" when a technician invited
 * them (wording differs) or "admin" for the admin assignment flow.
 *
 * The INSERT carries its own NOT EXISTS guard so two requests that interleave
 * between a caller's check and this write (double-click) cannot both land a
 * row. Returns { added: false } when the technician was already on the team.
 */
async function addCollaborator(ticket, tech, actor, note, via = "admin") {
  const res = await db.pRun(
    `INSERT INTO ticket_assignments (ticket_id, technician_id, assigned_by, reason, role_type, active, is_active)
     SELECT ?, ?, ?, ?, 'collaborator', 1, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM ticket_assignments
         WHERE ticket_id = ? AND technician_id = ? AND (active = 1 OR is_active = 1)
      )`,
    [ticket.id, tech.id, actor ? actor.id : null, note || null, ticket.id, tech.id],
  );
  if (!res.changes) return { added: false, role_type: "collaborator" };
  const who = actorLabel(actor);
  const detail =
    via === "invite"
      ? `${who} invited ${tech.username} as Collaborator.`
      : `${who} added ${tech.username} as Collaborator.`;
  await logActivity(
    ticket.id,
    actor,
    via === "invite" ? "ticket.collaborator_invited" : "ticket.collaborator_added",
    withNote(detail, note),
  );
  return { added: true, role_type: "collaborator" };
}

/**
 * Remove a technician from the team. Removing a Collaborator never touches the
 * Primary. Removing the Primary promotes the longest-standing Collaborator (so
 * a ticket does not silently become unassigned), or clears the PIC if none.
 */
async function removeAssignment(ticket, tech, actor) {
  const { primary } = await getTeam(ticket.id);
  const wasPrimary = primary && primary.technician_id === tech.id;

  await deactivate("AND technician_id = ?", [ticket.id, tech.id]);

  let promoted = null;
  if (wasPrimary) {
    const next = await db.pGet(
      `SELECT a.*, u.username FROM ticket_assignments a
         JOIN users u ON u.id = a.technician_id
        WHERE a.ticket_id = ? AND (a.active = 1 OR a.is_active = 1) AND a.technician_id != ?
        ORDER BY a.assigned_at ASC LIMIT 1`,
      [ticket.id, tech.id],
    );
    if (next) {
      await db.pRun("UPDATE ticket_assignments SET role_type = 'primary' WHERE id = ?", [next.id]);
      await syncPrimaryColumns(ticket.id, { id: next.technician_id, username: next.username });
      promoted = next;
    } else {
      await syncPrimaryColumns(ticket.id, null);
    }
  }

  const who = actorLabel(actor);
  let detail = wasPrimary
    ? `${who} removed ${tech.username} as Primary Technician / PIC.`
    : `${who} removed ${tech.username} from Collaborators.`;
  if (promoted) detail += ` ${promoted.username} is now Primary Technician / PIC.`;
  await logActivity(ticket.id, actor, "ticket.assignment_removed", detail);
  return { promoted };
}

function withNote(sentence, note) {
  const n = (note || "").trim();
  return n ? `${sentence} Note: ${n}` : sentence;
}

module.exports = {
  TERMINAL_STATUSES,
  actorLabel,
  getActiveAssignments,
  getTeam,
  isTeamMember,
  loadAssignableTechnician,
  setPrimary,
  addCollaborator,
  removeAssignment,
};
