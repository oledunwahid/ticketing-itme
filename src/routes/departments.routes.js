/* ==========================================================================
   Routes — Departments (reference / meta)
   Verbatim move from app.js. URL, middleware and response shape unchanged.
   Mounted at "/" so the full "/api/meta/departments" path is preserved.
   ========================================================================== */
const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { DEPARTMENTS } = require("../config/constants");

const router = express.Router();

router.get("/api/meta/departments", requireAuth, (req, res) => {
  res.json(DEPARTMENTS.map((code) => ({ code })));
});

module.exports = router;
