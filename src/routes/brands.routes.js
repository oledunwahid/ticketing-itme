/* ==========================================================================
   Routes — Brands (reference / meta)
   Verbatim move from app.js. URL, middleware and response shape unchanged.
   Mounted at "/" so the full "/api/meta/brands" path is preserved.
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/api/meta/brands", requireAuth, async (req, res) => {
  res.json(
    await db.pAll(
      "SELECT code, name FROM brands WHERE active = 1 ORDER BY code",
    ),
  );
});

module.exports = router;
