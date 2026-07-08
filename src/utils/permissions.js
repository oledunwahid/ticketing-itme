/* ==========================================================================
   Utils — RBAC & ticket-scoping helpers
   Verbatim move of the role-predicate / scope cluster from app.js.
   Logic unchanged. Depends on the shared db layer and ADMIN_ROLES constant.
   ========================================================================== */
const db = require("../../database");
const { ADMIN_ROLES } = require("../config/constants");

// --- Role predicates -------------------------------------------------------
const deptForRole = (role) =>
  role === "AdminIT" || role === "TechnicianIT"
    ? "IT"
    : role === "AdminME" || role === "TechnicianME"
      ? "ME"
      : null;
const isAdmin = (u) => ADMIN_ROLES.includes(u.role);
const isTechnician = (u) =>
  u.role === "TechnicianIT" || u.role === "TechnicianME";

// Can this user administer (edit/assign/close) this ticket's department?
function adminScopeForTicket(u, ticket) {
  if (u.role === "SuperAdmin") return true;
  if (u.role === "AdminIT") return ticket.department === "IT";
  if (u.role === "AdminME") return ticket.department === "ME";
  return false;
}
function canClose(u, ticket) {
  if (adminScopeForTicket(u, ticket)) return true;
  if (
    isTechnician(u) &&
    u.can_close_override &&
    ticket.assigned_technician_id === u.id
  )
    return true;
  return false;
}

// Load a user's brand/outlet access sets (cached per-request via req).
async function getUserScope(user) {
  if (user.all_brands || user.role === "SuperAdmin")
    return { allBrands: true, brands: [], outlets: [] };
  const brands = (
    await db.pAll(
      "SELECT brand_code FROM user_brand_access WHERE user_id = ?",
      [user.id],
    )
  ).map((r) => r.brand_code);
  if (user.brand && !brands.includes(user.brand)) brands.push(user.brand);
  const outlets = (
    await db.pAll(
      "SELECT outlet_code FROM user_outlet_access WHERE user_id = ?",
      [user.id],
    )
  ).map((r) => r.outlet_code);
  return { allBrands: false, brands, outlets };
}

// Technician PIC scope: their assigned PIC outlets + whether they have broad
// (all-outlet) access. Loaded from DB because the JWT does not carry these.
async function getTechnicianScope(user) {
  const row = await db.pGet("SELECT all_outlets FROM users WHERE id = ?", [
    user.id,
  ]);
  const allOutlets = !!(row && row.all_outlets);
  const picOutlets = (
    await db.pAll("SELECT outlet_code FROM user_outlet_access WHERE user_id = ?", [
      user.id,
    ])
  ).map((r) => r.outlet_code);
  return { allOutlets, picOutlets };
}

// Build a WHERE clause fragment scoping the tickets table to what `user` may see.
// opts.techFilter (technicians only): 'pic' (default) | 'mine' | 'unassigned_pic' | 'all'
async function buildTicketScope(user, opts = {}) {
  const clauses = [];
  const params = [];

  // Department scope (admins/technicians of a department)
  const dept = deptForRole(user.role);

  if (user.role === "SuperAdmin") {
    // no restriction
  } else if (user.role === "Requestor") {
    clauses.push("(requestor_user_id = ? OR LOWER(customer_email) = LOWER(?))");
    params.push(user.id, user.email);
  } else if (isTechnician(user)) {
    // Technicians are always capped to their department...
    clauses.push("department = ?");
    params.push(dept);

    // ...then scoped by their PIC outlet coverage / self-assignment, with a
    // selectable filter. This is the hard cap — the frontend cannot exceed it.
    const { allOutlets, picOutlets } = await getTechnicianScope(user);
    const filter = opts.techFilter || "pic";
    const picIn = picOutlets.length
      ? `outlet_code IN (${picOutlets.map(() => "?").join(",")})`
      : "0"; // no PIC outlets configured → PIC clause matches nothing
    const mine = "assigned_technician_id = ?";

    if (filter === "mine") {
      clauses.push(mine);
      params.push(user.id);
    } else if (filter === "unassigned_pic") {
      clauses.push(`(${picIn}) AND assigned_technician_id IS NULL`);
      if (picOutlets.length) params.push(...picOutlets);
    } else if (filter === "all") {
      // "All allowed" = whole department only if granted all-outlet access;
      // otherwise still capped to PIC outlets + own assignments.
      if (!allOutlets) {
        clauses.push(`((${picIn}) OR ${mine})`);
        if (picOutlets.length) params.push(...picOutlets);
        params.push(user.id);
      }
    } else {
      // 'pic' (default): PIC outlets OR tickets assigned to me (so a tech never
      // loses sight of their own jobs even outside their PIC coverage).
      clauses.push(`((${picIn}) OR ${mine})`);
      if (picOutlets.length) params.push(...picOutlets);
      params.push(user.id);
    }
  } else if (user.role === "AdminIT" || user.role === "AdminME") {
    clauses.push("department = ?");
    params.push(dept);
  } else if (user.role === "Leader") {
    // view-only; brand/outlet scoped below
  }

  // Brand/outlet scope for admins & leaders (not requestor/technician which are already narrow)
  if (["AdminIT", "AdminME", "Leader"].includes(user.role)) {
    const scope = await getUserScope(user);
    if (!scope.allBrands) {
      const parts = [];
      if (scope.brands.length) {
        parts.push(`brand_code IN (${scope.brands.map(() => "?").join(",")})`);
        params.push(...scope.brands);
      }
      if (scope.outlets.length) {
        parts.push(
          `outlet_code IN (${scope.outlets.map(() => "?").join(",")})`,
        );
        params.push(...scope.outlets);
      }
      if (parts.length) clauses.push(`(${parts.join(" OR ")})`);
      else clauses.push("1=0"); // scoped user with no access sees nothing
    }
  }

  return { clause: clauses.length ? clauses.join(" AND ") : "1=1", params };
}

module.exports = {
  deptForRole,
  isAdmin,
  isTechnician,
  adminScopeForTicket,
  canClose,
  getUserScope,
  getTechnicianScope,
  buildTicketScope,
};
