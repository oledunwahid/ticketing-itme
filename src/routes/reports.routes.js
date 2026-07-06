/* ==========================================================================
   Routes — Reports (/api/reports/*) + CSV export
   Verbatim move from app.js. URLs, middleware, RBAC, query filtering, CSV
   headers and response shapes unchanged. Mounted at "/" so full paths persist.
     GET /api/reports/tickets   (scoped, filtered JSON)
     GET /api/reports/export    (same filters → CSV download)
   Allowed roles: SuperAdmin, AdminIT, AdminME, Leader.
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { buildTicketScope } = require("../utils/permissions");
const { DEPARTMENTS } = require("../config/constants");

const router = express.Router();

async function queryReport(user, q) {
  const scope = await buildTicketScope(user);
  let sql = `SELECT t.*, o.display_label AS outlet_display FROM tickets t
             LEFT JOIN outlets o ON o.code = t.outlet_code
             WHERE ${scope.clause.replace(/\b(requestor_user_id|customer_email|assigned_technician_id|department|brand_code|outlet_code)\b/g, "t.$1")}`;
  const params = [...scope.params];
  const add = (frag, ...v) => {
    sql += frag;
    params.push(...v);
  };
  if (q.department && DEPARTMENTS.includes(q.department))
    add(" AND t.department = ?", q.department);
  if (q.brand) add(" AND t.brand_code = ?", q.brand);
  if (q.outlet) add(" AND t.outlet_code = ?", q.outlet);
  if (q.status) add(" AND t.status = ?", q.status);
  if (q.category) add(" AND t.category = ?", q.category);
  if (q.urgency) add(" AND t.urgency = ?", q.urgency);
  if (q.technician) add(" AND t.assignee_name = ?", q.technician);
  if (q.start_date) add(" AND date(t.created_at) >= date(?)", q.start_date);
  if (q.end_date) add(" AND date(t.created_at) <= date(?)", q.end_date);
  sql += " ORDER BY t.created_at DESC";
  return db.pAll(sql, params);
}

router.get(
  "/api/reports/tickets",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "Leader"),
  async (req, res) => {
    try {
      if (
        req.query.start_date &&
        req.query.end_date &&
        req.query.start_date > req.query.end_date
      ) {
        return res
          .status(400)
          .json({ error: "Start date must be before end date" });
      }
      res.json(await queryReport(req.user, req.query));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to run report" });
    }
  },
);

router.get(
  "/api/reports/export",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "Leader"),
  async (req, res) => {
    try {
      const rows = await queryReport(req.user, req.query);
      const cols = [
        "ticket_number",
        "department",
        "category",
        "outlet_display",
        "brand_code",
        "status",
        "urgency",
        "customer_name",
        "assignee_name",
        "created_at",
        "resolved_at",
        "closed_at",
      ];
      const header = [
        "Ticket",
        "Dept",
        "Category",
        "Outlet",
        "Brand",
        "Status",
        "Urgency",
        "Requestor",
        "Assignee",
        "Created",
        "Resolved",
        "Closed",
      ];
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      let csv = "﻿" + header.join(",") + "\n";
      for (const r of rows) csv += cols.map((c) => esc(r[c])).join(",") + "\n";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="report_${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to export" });
    }
  },
);

module.exports = router;
