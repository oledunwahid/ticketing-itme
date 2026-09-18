/* ==========================================================================
   Routes — Outlets (reference/meta + management)
     GET    /api/meta/outlets   (any authenticated user; active only)
     GET    /api/outlets        (admins; with ticket counts)
     POST   /api/outlets
     PATCH  /api/outlets/:id
     DELETE /api/outlets/:id
   Tickets and PIC coverage reference outlets by CODE, so renaming a code is
   carried over to them in one transaction.
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ADMIN_ROLES } = require("../config/constants");

const router = express.Router();

const CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{0,29}$/;
const BRAND_RE = /^[A-Z0-9][A-Z0-9 _.&-]{0,29}$/;
const clean = (v, max) => String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);

router.get("/api/meta/outlets", requireAuth, async (req, res) => {
  try {
    res.json(
      await db.pAll(
        "SELECT code, name, brand_code, display_label, region FROM outlets WHERE active = 1 ORDER BY brand_code, code",
      ),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load outlets" });
  }
});

router.get("/api/outlets", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    res.json(
      await db.pAll(
        `SELECT o.*,
                (SELECT COUNT(*) FROM tickets t WHERE t.outlet_code = o.code) AS ticket_count,
                (SELECT COUNT(*) FROM tickets t WHERE t.outlet_code = o.code
                    AND t.status NOT IN ('Resolved','Closed','Cancelled')) AS open_count
           FROM outlets o ORDER BY o.brand_code, o.code`,
      ),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch outlets" });
  }
});

router.post("/api/outlets", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const brandCode = clean(b.brand_code, 30).toUpperCase();
    const code = clean(b.code, 30).toUpperCase();
    const name = clean(b.name, 100);
    const displayLabel = clean(b.display_label, 100) || name;
    const region = clean(b.region, 40) || "Jakarta";

    if (!brandCode) return res.status(400).json({ error: "Brand Code is required" });
    if (!BRAND_RE.test(brandCode))
      return res.status(400).json({ error: "Brand Code may only use letters, numbers, spaces and - _ . &" });
    if (!code) return res.status(400).json({ error: "Outlet Code is required" });
    if (!CODE_RE.test(code))
      return res.status(400).json({ error: "Outlet Code may only use letters, numbers and - _ ." });
    if (!name) return res.status(400).json({ error: "Outlet Name is required" });

    const existing = await db.pGet("SELECT id FROM outlets WHERE LOWER(code) = LOWER(?)", [code]);
    if (existing)
      return res.status(400).json({ error: `Outlet Code "${code}" is already in use` });

    await db.pRun("INSERT OR IGNORE INTO brands (code, name) VALUES (?, ?)", [brandCode, brandCode]);
    const r = await db.pRun(
      "INSERT INTO outlets (code, name, brand_code, display_label, region, active) VALUES (?, ?, ?, ?, ?, ?)",
      [code, name, brandCode, displayLabel, region, b.active !== false ? 1 : 0],
    );
    res.status(201).json(await db.pGet("SELECT * FROM outlets WHERE id = ?", [r.lastID]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create outlet" });
  }
});

router.patch("/api/outlets/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid outlet ID" });
    const outlet = await db.pGet("SELECT * FROM outlets WHERE id = ?", [id]);
    if (!outlet) return res.status(404).json({ error: "Outlet not found" });

    const b = req.body || {};
    const next = { ...outlet };
    if (b.brand_code !== undefined) {
      const brandCode = clean(b.brand_code, 30).toUpperCase();
      if (!brandCode || (brandCode !== outlet.brand_code && !BRAND_RE.test(brandCode)))
        return res.status(400).json({ error: "Brand Code may only use letters, numbers, spaces and - _ . &" });
      next.brand_code = brandCode;
    }
    if (b.code !== undefined) {
      const code = clean(b.code, 30).toUpperCase();
      if (!code || (code !== outlet.code && !CODE_RE.test(code)))
        return res.status(400).json({ error: "Outlet Code may only use letters, numbers and - _ ." });
      const clash = await db.pGet("SELECT id FROM outlets WHERE LOWER(code) = LOWER(?) AND id != ?", [code, id]);
      if (clash)
        return res.status(400).json({ error: `Outlet Code "${code}" is already in use by another outlet` });
      next.code = code;
    }
    if (b.name !== undefined) {
      const name = clean(b.name, 100);
      if (!name) return res.status(400).json({ error: "Outlet Name cannot be empty" });
      next.name = name;
    }
    if (b.display_label !== undefined) next.display_label = clean(b.display_label, 100) || next.name;
    if (b.region !== undefined) next.region = clean(b.region, 40) || "Jakarta";
    if (b.active !== undefined) next.active = b.active ? 1 : 0;

    const codeChanged = next.code !== outlet.code;
    let moved = 0;
    await db.transaction(async () => {
      if (next.brand_code !== outlet.brand_code)
        await db.pRun("INSERT OR IGNORE INTO brands (code, name) VALUES (?, ?)", [next.brand_code, next.brand_code]);
      await db.pRun(
        "UPDATE outlets SET code = ?, name = ?, brand_code = ?, display_label = ?, region = ?, active = ? WHERE id = ?",
        [next.code, next.name, next.brand_code, next.display_label, next.region, next.active, id],
      );
      if (codeChanged) {
        moved = (await db.pRun("UPDATE tickets SET outlet_code = ? WHERE outlet_code = ?", [next.code, outlet.code])).changes;
        await db.pRun("UPDATE OR IGNORE user_outlet_access SET outlet_code = ? WHERE outlet_code = ?", [next.code, outlet.code]);
        await db.pRun("DELETE FROM user_outlet_access WHERE outlet_code = ?", [outlet.code]);
        await db.pRun("UPDATE users SET default_outlet_code = ? WHERE default_outlet_code = ?", [next.code, outlet.code]);
      }
      // Brand is derived from the outlet — keep the tickets' brand in step.
      if (next.brand_code !== outlet.brand_code)
        await db.pRun("UPDATE tickets SET brand_code = ? WHERE outlet_code = ?", [next.brand_code, next.code]);
    });
    const updated = await db.pGet("SELECT * FROM outlets WHERE id = ?", [id]);
    res.json({ ...updated, tickets_moved: moved });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update outlet" });
  }
});

router.delete("/api/outlets/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid outlet ID" });
    const outlet = await db.pGet("SELECT id, code, name FROM outlets WHERE id = ?", [id]);
    if (!outlet) return res.status(404).json({ error: "Outlet not found" });

    const refs = await db.pGet(
      `SELECT (SELECT COUNT(*) FROM tickets WHERE outlet_code = ?) AS tickets,
              (SELECT COUNT(*) FROM user_outlet_access WHERE outlet_code = ?) AS pic`,
      [outlet.code, outlet.code],
    );
    if (refs.tickets + refs.pic > 0) {
      const parts = [];
      if (refs.tickets) parts.push(`${refs.tickets} ticket(s)`);
      if (refs.pic) parts.push(`${refs.pic} technician PIC assignment(s)`);
      return res.status(409).json({
        error:
          `"${outlet.name}" (${outlet.code}) is used by ${parts.join(" and ")} ` +
          `and cannot be deleted. Switch Active off in Edit instead. It stays on ` +
          `existing tickets and reports but disappears from new ticket forms.`,
        in_use: true,
        used_by: refs.tickets + refs.pic,
      });
    }
    const r = await db.pRun("DELETE FROM outlets WHERE id = ?", [id]);
    if (r.changes === 0) return res.status(404).json({ error: "Outlet not found" });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete outlet" });
  }
});

module.exports = router;
