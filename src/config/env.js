/* ==========================================================================
   Config — environment
   Centralizes runtime env values. A local .env file is loaded first, but it
   never overrides a variable that is already set in the real environment
   (so a service manager / container can always win).
   ========================================================================== */
const path = require("path");
const fs = require("fs");

// Project root = two levels up from src/config/ (…/src/config -> …/src -> …/root)
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function loadEnv() {
  try {
    const envPath = path.join(PROJECT_ROOT, ".env");
    if (!fs.existsSync(envPath)) return;
    const envContent = fs.readFileSync(envPath, "utf8");
    envContent.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const index = trimmed.indexOf("=");
      if (index === -1) return;
      const key = trimmed.substring(0, index).trim();
      let val = trimmed.substring(index + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    });
  } catch (e) {
    console.warn("[env] Failed to load .env file:", e.message);
  }
}
loadEnv();

const bool = (v, dflt) => (v === undefined || v === "" ? dflt : /^(1|true|yes|on)$/i.test(String(v)));

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const PORT = process.env.PORT !== undefined && process.env.PORT !== "" && Number.isInteger(Number(process.env.PORT))
  ? Number(process.env.PORT)
  : 3001;
const HOST = process.env.HOST || "0.0.0.0";
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(PROJECT_ROOT, "tickets.db");
const APP_URL = (process.env.APP_URL || "http://theuniongroup.synology.me:3001").replace(/\/+$/, "");

// Refuse to boot in production without a real secret.
if (IS_PROD && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET must be set in production.");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || "union-dev-secret-change-me";
const WEAK_SECRETS = [
  "union-dev-secret-change-me",
  "replace-with-a-long-random-secret",
  "super-secret-key-change-this-for-production!",
];
if (IS_PROD && (JWT_SECRET.length < 32 || WEAK_SECRETS.includes(JWT_SECRET))) {
  console.warn(
    "[security] JWT_SECRET is weak or a documented example value. Generate one with:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
  );
}

// Session cookie `Secure` flag. Browsers silently DROP a Secure cookie on plain
// HTTP, which breaks login on an on-prem http:// deployment — so it follows the
// public URL's scheme unless COOKIE_SECURE is set explicitly.
const COOKIE_SECURE = bool(process.env.COOKIE_SECURE, APP_URL.startsWith("https://"));

// Only needed when a reverse proxy (Synology DSM, nginx) sits in front, so that
// rate limiting sees the real client IP. e.g. TRUST_PROXY=1 or "loopback".
const TRUST_PROXY = process.env.TRUST_PROXY || "";

// Cross-origin API access is OFF by default: the SPA is served from the same
// origin. List extra origins (comma separated) only if another site must call
// the API with the session cookie.
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

module.exports = {
  PROJECT_ROOT,
  NODE_ENV,
  IS_PROD,
  PORT,
  HOST,
  DB_PATH,
  JWT_SECRET,
  APP_URL,
  COOKIE_SECURE,
  TRUST_PROXY,
  CORS_ORIGINS,
};
