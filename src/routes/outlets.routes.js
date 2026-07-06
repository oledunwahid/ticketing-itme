/* ==========================================================================
   Routes — Outlets (reference/meta + management)
   Verbatim move from app.js. URLs, middleware, validation and response
   shapes unchanged. Mounted at "/" so full paths are preserved.
     GET    /api/meta/outlets   (any authenticated user)
     GET    /api/outlets        (SuperAdmin/AdminIT/AdminME/TechnicianIT/TechnicianME)
     POST   /api/outlets
     PATCH  /api/outlets/:id
     DELETE /api/outlets/:id
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/api/meta/outlets", requireAuth, async (req, res) => {
  const rows = await db.pAll(
    "SELECT code, name, brand_code, display_label FROM outlets WHERE active = 1 ORDER BY brand_code, code",
  );
  res.json(rows);
});

// ==========================================================================
// Location (Outlets) Management API Endpoints (RBAC Enforced)
// Allowed roles: SuperAdmin, AdminIT, AdminME, TechnicianIT, TechnicianME
// ==========================================================================
router.get(
  "/api/outlets",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const sql = "SELECT * FROM outlets ORDER BY brand_code, code";
      const rows = await db.pAll(sql);
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch outlets" });
    }
  }
);

router.post(
  "/api/outlets",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const brandCode = String(req.body.brand_code || "").trim().toUpperCase();
      const code = String(req.body.code || "").trim().toUpperCase();
      const name = String(req.body.name || "").trim();
      const displayLabel = String(req.body.display_label || name).trim();

      if (!brandCode) return res.status(400).json({ error: "Brand Code is required" });
      if (!code) return res.status(400).json({ error: "Outlet Code is required" });
      if (!name) return res.status(400).json({ error: "Outlet Name is required" });

      // Automatically seed brand if it doesn't exist
      await db.pRun("INSERT OR IGNORE INTO brands (code, name) VALUES (?, ?)", [brandCode, brandCode]);

      // Check unique outlet code
      const existing = await db.pGet("SELECT id FROM outlets WHERE LOWER(code) = LOWER(?)", [code]);
      if (existing) {
        return res.status(400).json({ error: `Outlet Code "${code}" is already in use` });
      }

      const active = req.body.active !== false ? 1 : 0;
      const r = await db.pRun(
        "INSERT INTO outlets (code, name, brand_code, display_label, active) VALUES (?, ?, ?, ?, ?)",
        [code, name, brandCode, displayLabel, active]
      );
      const newOutlet = await db.pGet("SELECT * FROM outlets WHERE id = ?", [r.lastID]);
      res.status(201).json(newOutlet);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create outlet" });
    }
  }
);

router.patch(
  "/api/outlets/:id",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid outlet ID" });

      const outlet = await db.pGet("SELECT * FROM outlets WHERE id = ?", [id]);
      if (!outlet) return res.status(404).json({ error: "Outlet not found" });

      const updates = [];
      const params = [];
      const set = (col, val) => {
        updates.push(`${col} = ?`);
        params.push(val);
      };

      if (req.body.brand_code !== undefined) {
        const brandCode = String(req.body.brand_code || "").trim().toUpperCase();
        if (!brandCode) return res.status(400).json({ error: "Brand Code cannot be empty" });
        await db.pRun("INSERT OR IGNORE INTO brands (code, name) VALUES (?, ?)", [brandCode, brandCode]);
        set("brand_code", brandCode);
      }

      if (req.body.code !== undefined) {
        const code = String(req.body.code || "").trim().toUpperCase();
        if (!code) return res.status(400).json({ error: "Outlet Code cannot be empty" });

        const existing = await db.pGet("SELECT id FROM outlets WHERE LOWER(code) = LOWER(?) AND id != ?", [code, id]);
        if (existing) {
          return res.status(400).json({ error: `Outlet Code "${code}" is already in use by another outlet` });
        }
        set("code", code);
      }

      if (req.body.name !== undefined) {
        const name = String(req.body.name || "").trim();
        if (!name) return res.status(400).json({ error: "Outlet Name cannot be empty" });
        set("name", name);
      }

      if (req.body.display_label !== undefined) {
        const displayLabel = String(req.body.display_label || "").trim();
        set("display_label", displayLabel);
      }

      if (req.body.active !== undefined) {
        set("active", req.body.active ? 1 : 0);
      }

      if (!updates.length) return res.status(400).json({ error: "No fields to update" });

      await db.pRun(`UPDATE outlets SET ${updates.join(", ")} WHERE id = ?`, [...params, id]);
      const updated = await db.pGet("SELECT * FROM outlets WHERE id = ?", [id]);
      res.json(updated);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update outlet" });
    }
  }
);

router.delete(
  "/api/outlets/:id",
  requireAuth,
  requireRole("SuperAdmin", "AdminIT", "AdminME", "TechnicianIT", "TechnicianME"),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid outlet ID" });

      const r = await db.pRun("DELETE FROM outlets WHERE id = ?", [id]);
      if (r.changes === 0) return res.status(404).json({ error: "Outlet not found" });
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete outlet" });
    }
  }
);

module.exports = router;
