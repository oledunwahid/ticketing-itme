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

// Build a WHERE clause fragment scoping the tickets table to what `user` may see.
async function buildTicketScope(user) {
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
    clauses.push("assigned_technician_id = ?");
    params.push(user.id);
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
  buildTicketScope,
};
