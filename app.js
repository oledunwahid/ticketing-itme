/* ==========================================================================
   IT-ME Ticketing — Backend bootstrap (Express + SQLite)

   This file is intentionally thin: it wires the app together and starts it.
   All domain logic lives in modules under src/:
     src/config/      env, constants, uploads
     src/middleware/  auth (rateLimit, requireAuth, requireRole, tokens)
     src/utils/       permissions, ticketNumber, statusTransition
     src/services/    tickets, auditLog, upload validation
     src/routes/      auth, brands, outlets, departments, categories,
                      tickets, technicians, reports, users, attachments
   ========================================================================== */
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const cookieParser = require("cookie-parser");
const db = require("./database");
const { PORT } = require("./src/config/env");

const app = express();

// --- Middleware ------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

// --- API routes (each router uses full "/api/..." paths, mounted at "/") ----
app.use(require("./src/routes/auth.routes"));
app.use(require("./src/routes/brands.routes"));
app.use(require("./src/routes/outlets.routes"));
app.use(require("./src/routes/departments.routes"));
app.use(require("./src/routes/categories.routes"));
app.use(require("./src/routes/tickets.routes")); // includes GET /api/dashboard
app.use(require("./src/routes/technicians.routes"));
app.use(require("./src/routes/reports.routes"));
app.use(require("./src/routes/users.routes"));
app.use(require("./src/routes/attachments.routes"));

// --- Static + SPA ----------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Error handler ---------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong on the server!" });
});

// --- Start (after DB is ready) ---------------------------------------------
db.ready.then(() => {
  app.listen(PORT, () => {
    console.log(`IT-ME Ticketing server running at http://localhost:${PORT}`);
  });
});

module.exports = app;
