/* ==========================================================================
   Routes — Categories (reference/meta + management)
   Verbatim move from app.js. URLs, middleware, validation and response
   shapes unchanged. Mounted at "/" so full paths are preserved.
     GET    /api/meta/categories  (any authenticated user)
     GET    /api/categories       (SuperAdmin/AdminIT/AdminME/TechnicianIT/TechnicianME)
     POST   /api/categories
     PATCH  /api/categories/:id
     DELETE /api/categories/:id
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { DEPARTMENTS } = require("../config/constants");

const router = express.Router();

router.get("/api/meta/categories", requireAuth, async (req, res) => {
  const { department } = req.query;
  const params = [];
  let sql = "SELECT department_code, name FROM categories WHERE active = 1";
  if (department) {
    sql += " AND department_code = ?";
    params.push(department);
  }
  sql += " ORDER BY sort_order, name";
  res.json(await db.pAll(sql, params));
});

// ==========================================================================
// Category Management API Endpoints (RBAC Enforced)
// Allowed roles: SuperAdmin, AdminIT, AdminME, TechnicianIT, TechnicianME
// ==========================================================================
router.get(
  "/api/categories",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const sql = "SELECT * FROM categories ORDER BY department_code, sort_order, name";
      const rows = await db.pAll(sql);
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  }
);

router.post(
  "/api/categories",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const dept = String(req.body.department_code || "").toUpperCase();
      if (!DEPARTMENTS.includes(dept)) {
        return res.status(400).json({ error: "Department code must be IT or ME" });
      }
      const name = String(req.body.name || "").trim();
      if (!name) {
        return res.status(400).json({ error: "Category name is required" });
      }

      // Check for duplicate category name within the same department
      const existing = await db.pGet(
        "SELECT id FROM categories WHERE department_code = ? AND LOWER(name) = LOWER(?)",
        [dept, name]
      );
      if (existing) {
        return res.status(400).json({ error: "Category already exists in this department" });
      }

      const active = req.body.active !== false ? 1 : 0;
      const sortOrder = Number(req.body.sort_order) || 0;

      const r = await db.pRun(
        "INSERT INTO categories (department_code, name, active, sort_order) VALUES (?, ?, ?, ?)",
        [dept, name, active, sortOrder]
      );
      const newCat = await db.pGet("SELECT * FROM categories WHERE id = ?", [r.lastID]);
      res.status(201).json(newCat);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create category" });
    }
  }
);

router.patch(
  "/api/categories/:id",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid category ID" });

      const cat = await db.pGet("SELECT * FROM categories WHERE id = ?", [id]);
      if (!cat) return res.status(404).json({ error: "Category not found" });

      const updates = [];
      const params = [];
      const set = (col, val) => {
        updates.push(`${col} = ?`);
        params.push(val);
      };

      if (req.body.department_code !== undefined) {
        const dept = String(req.body.department_code || "").toUpperCase();
        if (!DEPARTMENTS.includes(dept)) {
          return res.status(400).json({ error: "Department code must be IT or ME" });
        }
        set("department_code", dept);
      }

      if (req.body.name !== undefined) {
        const name = String(req.body.name || "").trim();
        if (!name) return res.status(400).json({ error: "Category name is required" });
        set("name", name);
      }

      if (req.body.active !== undefined) {
        set("active", req.body.active ? 1 : 0);
      }

      if (req.body.sort_order !== undefined) {
        set("sort_order", Number(req.body.sort_order) || 0);
      }

      if (!updates.length) return res.status(400).json({ error: "No fields to update" });

      // Check unique constraint if name or department changes
      const checkDept = req.body.department_code !== undefined ? String(req.body.department_code).toUpperCase() : cat.department_code;
      const checkName = req.body.name !== undefined ? String(req.body.name).trim() : cat.name;
      if (req.body.department_code !== undefined || req.body.name !== undefined) {
        const existing = await db.pGet(
          "SELECT id FROM categories WHERE department_code = ? AND LOWER(name) = LOWER(?) AND id != ?",
          [checkDept, checkName, id]
        );
        if (existing) {
          return res.status(400).json({ error: "Another category with this name already exists in this department" });
        }
      }

      await db.pRun(`UPDATE categories SET ${updates.join(", ")} WHERE id = ?`, [...params, id]);
      const updated = await db.pGet("SELECT * FROM categories WHERE id = ?", [id]);
      res.json(updated);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update category" });
    }
  }
);

router.delete(
  "/api/categories/:id",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid category ID" });

      const cat = await db.pGet(
        "SELECT id, name, department_code FROM categories WHERE id = ?",
        [id],
      );
      if (!cat) return res.status(404).json({ error: "Category not found" });

      // In use → refuse, and point at the Active toggle. Deleting would leave
      // existing tickets pointing at a category that no longer exists, which
      // breaks their history and every report that groups by category.
      const used = await db.pGet(
        "SELECT COUNT(*) c FROM tickets WHERE department = ? AND category = ?",
        [cat.department_code, cat.name],
      );
      if (used && used.c > 0) {
        return res.status(409).json({
          error:
            `"${cat.name}" is used by ${used.c} ticket(s) and cannot be deleted. ` +
            `Switch Active off in Edit instead — it stays on existing tickets and ` +
            `reports but disappears from new ticket forms.`,
          in_use: true,
          used_by: used.c,
        });
      }

      const r = await db.pRun("DELETE FROM categories WHERE id = ?", [id]);
      if (r.changes === 0) return res.status(404).json({ error: "Category not found" });
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete category" });
    }
  }
);

module.exports = router;
