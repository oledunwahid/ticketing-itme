/* ==========================================================================
   Routes — Categories (reference/meta + management)
     GET    /api/meta/categories  (any authenticated user; active only)
     GET    /api/categories       (admins + technicians; with usage counts)
     POST   /api/categories
     PATCH  /api/categories/:id
     DELETE /api/categories/:id
   Mutations are department scoped: SuperAdmin manages both departments;
   IT admins/technicians manage IT categories, ME admins/technicians ME ones.
   Tickets store the category NAME, so a rename is carried over to them.
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { DEPARTMENTS } = require("../config/constants");
const { deptForRole } = require("../utils/permissions");

const router = express.Router();
const MANAGE_ROLES = ["SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"];
const canManageDept = (user, dept) => user.role === "SuperAdmin" || deptForRole(user.role) === dept;

router.get("/api/meta/categories", requireAuth, async (req, res) => {
  try {
    const params = [];
    let sql = "SELECT department_code, name FROM categories WHERE active = 1";
    if (req.query.department) {
      sql += " AND department_code = ?";
      params.push(String(req.query.department));
    }
    sql += " ORDER BY sort_order, name";
    res.json(await db.pAll(sql, params));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load categories" });
  }
});

router.get("/api/categories", requireAuth, requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const rows = await db.pAll(
      `SELECT c.*,
              (SELECT COUNT(*) FROM tickets t WHERE t.department = c.department_code AND t.category = c.name) AS ticket_count
         FROM categories c
        ORDER BY c.department_code, c.sort_order, c.name`,
    );
    for (const r of rows) r.can_manage = canManageDept(req.user, r.department_code);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

function readName(v) {
  const name = String(v || "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Category name is required" };
  if (name.length > 60) return { error: "Category name is too long (max 60 characters)" };
  return { name };
}
const readSort = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-9999, Math.min(9999, Math.trunc(n))) : 0;
};

router.post("/api/categories", requireAuth, requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const dept = String(b.department_code || "").toUpperCase();
    if (!DEPARTMENTS.includes(dept))
      return res.status(400).json({ error: "Department code must be IT or ME" });
    if (!canManageDept(req.user, dept))
      return res.status(403).json({ error: `You can only manage ${deptForRole(req.user.role)} categories` });
    const { name, error } = readName(b.name);
    if (error) return res.status(400).json({ error });

    const existing = await db.pGet(
      "SELECT id FROM categories WHERE department_code = ? AND LOWER(name) = LOWER(?)",
      [dept, name],
    );
    if (existing)
      return res.status(400).json({ error: "Category already exists in this department" });

    const r = await db.pRun(
      "INSERT INTO categories (department_code, name, active, sort_order) VALUES (?, ?, ?, ?)",
      [dept, name, b.active !== false ? 1 : 0, readSort(b.sort_order)],
    );
    res.status(201).json(await db.pGet("SELECT * FROM categories WHERE id = ?", [r.lastID]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create category" });
  }
});

router.patch("/api/categories/:id", requireAuth, requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid category ID" });
    const cat = await db.pGet("SELECT * FROM categories WHERE id = ?", [id]);
    if (!cat) return res.status(404).json({ error: "Category not found" });
    if (!canManageDept(req.user, cat.department_code))
      return res.status(403).json({ error: `You can only manage ${deptForRole(req.user.role)} categories` });

    const b = req.body || {};
    const next = {
      department_code: cat.department_code,
      name: cat.name,
      active: cat.active,
      sort_order: cat.sort_order,
    };
    if (b.department_code !== undefined) {
      const dept = String(b.department_code || "").toUpperCase();
      if (!DEPARTMENTS.includes(dept))
        return res.status(400).json({ error: "Department code must be IT or ME" });
      if (!canManageDept(req.user, dept))
        return res.status(403).json({ error: "You cannot move a category to another department" });
      next.department_code = dept;
    }
    if (b.name !== undefined) {
      const { name, error } = readName(b.name);
      if (error) return res.status(400).json({ error });
      next.name = name;
    }
    if (b.active !== undefined) next.active = b.active ? 1 : 0;
    if (b.sort_order !== undefined) next.sort_order = readSort(b.sort_order);

    const renamed = next.name !== cat.name;
    const moved = next.department_code !== cat.department_code;
    if (renamed || moved) {
      const clash = await db.pGet(
        "SELECT id FROM categories WHERE department_code = ? AND LOWER(name) = LOWER(?) AND id != ?",
        [next.department_code, next.name, id],
      );
      if (clash)
        return res.status(400).json({ error: "Another category with this name already exists in this department" });
    }
    const used = (
      await db.pGet("SELECT COUNT(*) c FROM tickets WHERE department = ? AND category = ?", [cat.department_code, cat.name])
    ).c;
    if (moved && used)
      return res.status(409).json({
        error: `"${cat.name}" is used by ${used} ${cat.department_code} ticket(s) and cannot move department. Create a new category instead.`,
      });

    await db.transaction(async () => {
      await db.pRun(
        "UPDATE categories SET department_code = ?, name = ?, active = ?, sort_order = ? WHERE id = ?",
        [next.department_code, next.name, next.active, next.sort_order, id],
      );
      if (renamed && used) {
        await db.pRun(
          "UPDATE tickets SET category = ? WHERE department = ? AND category = ?",
          [next.name, cat.department_code, cat.name],
        );
        await db.pRun(
          "UPDATE technician_skills SET category_name = ? WHERE category_name = ? AND (department_code = ? OR department_code IS NULL)",
          [next.name, cat.name, cat.department_code],
        );
      }
    });
    const updated = await db.pGet("SELECT * FROM categories WHERE id = ?", [id]);
    res.json({ ...updated, tickets_renamed: renamed ? used : 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update category" });
  }
});

router.delete("/api/categories/:id", requireAuth, requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid category ID" });
    const cat = await db.pGet("SELECT id, name, department_code FROM categories WHERE id = ?", [id]);
    if (!cat) return res.status(404).json({ error: "Category not found" });
    if (!canManageDept(req.user, cat.department_code))
      return res.status(403).json({ error: `You can only manage ${deptForRole(req.user.role)} categories` });

    const used = await db.pGet(
      "SELECT COUNT(*) c FROM tickets WHERE department = ? AND category = ?",
      [cat.department_code, cat.name],
    );
    if (used && used.c > 0) {
      return res.status(409).json({
        error:
          `"${cat.name}" is used by ${used.c} ticket(s) and cannot be deleted. ` +
          `Switch Active off in Edit instead. It stays on existing tickets and ` +
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
});

module.exports = router;
