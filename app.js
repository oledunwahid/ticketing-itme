/* ==========================================================================
   IT-ME Ticketing — Backend bootstrap (Express + SQLite)

   This file is intentionally thin: it wires the app together and starts it.
   All domain logic lives in modules under src/:
     src/config/      env, constants, uploads
     src/middleware/  auth (rateLimit, requireAuth, requireRole, tokens)
     src/utils/       permissions, ticketNumber, statusTransition, validate
     src/services/    tickets, auditLog, upload, assignment
     src/routes/      auth, brands, outlets, departments, categories,
                      tickets, technicians, reports, users, attachments,
                      importexport, public
   ========================================================================== */
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const cookieParser = require("cookie-parser");
const {
  PORT,
  HOST,
  IS_PROD,
  TRUST_PROXY,
  CORS_ORIGINS,
  APP_URL,
  COOKIE_SECURE,
} = require("./src/config/env");
const db = require("./database");
const { cleanupUploads } = require("./src/services/upload.service");

const app = express();
app.disable("x-powered-by");
if (TRUST_PROXY) {
  app.set("trust proxy", /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
}

// --- Security headers (no extra dependency) --------------------------------
// The SPA only loads its own script/style; inline style attributes are used by
// the renderer, hence 'unsafe-inline' for styles only. No HSTS: on-prem
// deployments are commonly plain HTTP.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", CSP);
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});

// --- CORS ------------------------------------------------------------------
// Same-origin by default (no CORS headers at all). Extra origins must be listed
// explicitly in CORS_ORIGINS; they get credentialed access.
if (CORS_ORIGINS.length) {
  app.use(
    "/api",
    cors({
      origin(origin, cb) {
        if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );
}

// CSRF defence in depth (the session cookie is already SameSite=Strict):
// state-changing API calls from a browser must come from an allowed origin.
const allowedOrigins = new Set([APP_URL, ...CORS_ORIGINS].map((o) => o.toLowerCase()));
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next(); // non-browser clients / same-origin navigations
  const host = req.get("host");
  const self = host && [`http://${host}`, `https://${host}`].includes(origin.toLowerCase());
  if (self || allowedOrigins.has(origin.toLowerCase())) return next();
  return res.status(403).json({ error: "Cross-site request blocked." });
});

// --- Body parsing / logging -------------------------------------------------
app.use(express.json({ limit: "3mb" })); // CSV imports travel as JSON
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cookieParser());
app.use(morgan(IS_PROD ? "combined" : "dev", {
  // Tracking tokens travel in the query string — keep them out of the logs.
  skip: (req) => req.path === "/api/health",
}));
morgan.token("url", (req) => String(req.originalUrl || req.url).replace(/token=[^&]+/g, "token=***"));

// --- Health (for on-prem monitoring; no data exposed) ----------------------
app.get("/api/health", async (req, res) => {
  try {
    await db.pGet("SELECT 1");
    res.json({ ok: true, uptime_s: Math.round(process.uptime()) });
  } catch (_) {
    res.status(503).json({ ok: false });
  }
});

// --- API routes (each router uses full "/api/..." paths, mounted at "/") ----
app.use(require("./src/routes/auth.routes"));
app.use(require("./src/routes/brands.routes"));
app.use(require("./src/routes/outlets.routes"));
app.use(require("./src/routes/departments.routes"));
app.use(require("./src/routes/categories.routes"));
app.use(require("./src/routes/tickets.routes")); // includes GET /api/dashboard
app.use(require("./src/routes/analytics.routes")); // BI dashboard + xlsx/csv export
app.use(require("./src/routes/technicians.routes"));
app.use(require("./src/routes/reports.routes"));
app.use(require("./src/routes/users.routes"));
app.use(require("./src/routes/attachments.routes"));
app.use(require("./src/routes/importexport.routes")); // CSV import/export (admin)
// Public quick-report disabled: every user must sign in.
// app.use(require("./src/routes/public.routes"));

app.all("/api/*", (req, res) => res.status(404).json({ error: "Not found" }));

// --- Static + SPA ----------------------------------------------------------
app.use(
  express.static(path.join(__dirname, "public"), {
    index: false,
    // Assets are small and change with deploys: revalidate, but cheaply (ETag).
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  }),
);
app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Error handler ---------------------------------------------------------
app.use((err, req, res, _next) => {
  if (err && err.type === "entity.too.large")
    return res.status(413).json({ error: "The request is too large." });
  if (err && err.type === "entity.parse.failed")
    return res.status(400).json({ error: "Malformed JSON body." });
  if (err && err.name === "MulterError") {
    const msg = err.code === "LIMIT_FILE_SIZE"
      ? "File exceeds the maximum size limit."
      : err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT"
        ? "Upload one file at a time."
        : "Upload rejected.";
    return res.status(400).json({ error: msg });
  }
  if (err && err.code === "SQLITE_BUSY")
    return res.status(503).json({ error: "The server is busy. Please retry in a moment." });
  console.error(err && err.stack ? err.stack : err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong on the server." });
});

// --- Start (after DB is ready) ---------------------------------------------
function start() {
  return db.ready.then(() => new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST);
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") console.error(`FATAL: port ${PORT} is already in use.`);
      reject(err);
    });
    server.once("listening", () => {
      console.log(
        `IT-ME Ticketing server running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${server.address().port}` +
          ` (public URL ${APP_URL}, secure cookies ${COOKIE_SECURE ? "on" : "off"})`,
      );
      resolve(server);
    });
    cleanupUploads();

    let closing = false;
    const shutdown = (signal) => {
      if (closing) return;
      closing = true;
      console.log(`${signal} received — shutting down…`);
      server.close(() => db.close(() => process.exit(0)));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }));
}

if (require.main === module) start().catch(() => process.exit(1));

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

module.exports = app;
module.exports.start = start;
