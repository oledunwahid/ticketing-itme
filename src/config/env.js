/* ==========================================================================
   Config — environment
   Centralizes runtime env values. Behavior is IDENTICAL to the previous
   inline definitions in app.js (same defaults, same production guard).
   ========================================================================== */
const path = require("path");
const fs = require("fs");

// Project root = two levels up from src/config/ (…/src/config -> …/src -> …/root)
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// Function to load/reload local .env file
function loadEnv() {
  try {
    const envPath = path.join(PROJECT_ROOT, ".env");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      envContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const index = trimmed.indexOf("=");
        if (index === -1) return;
        const key = trimmed.substring(0, index).trim();
        let val = trimmed.substring(index + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      });
    }
  } catch (e) {
    console.warn("[env] Failed to load .env file:", e.message);
  }
}
loadEnv();

const NODE_ENV = process.env.NODE_ENV;
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(PROJECT_ROOT, "tickets.db");
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
  HOST,
  DB_PATH,
  JWT_SECRET,
};

