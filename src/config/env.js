/* ==========================================================================
   Config — environment
   Centralizes runtime env values. Behavior is IDENTICAL to the previous
   inline definitions in app.js (same defaults, same production guard).
   ========================================================================== */
const path = require("path");

// Project root = two levels up from src/config/ (…/src/config -> …/src -> …/root)
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const NODE_ENV = process.env.NODE_ENV;
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "union-dev-secret-change-me";

// Same guard as before: refuse to boot in production without a real secret.
if (NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET must be set in production.");
  process.exit(1);
}

module.exports = {
  PROJECT_ROOT,
  NODE_ENV,
  PORT,
  JWT_SECRET,
};
