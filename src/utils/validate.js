/* ==========================================================================
   Util — input validation helpers shared by the routes.
   Small and dependency-free on purpose.
   ========================================================================== */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,128}$/;

// Field length caps (characters).
const LIMITS = {
  title: 200,
  description: 5000,
  name: 120,
  contact: 40,
  note: 2000,
  short: 255,
};

function validatePassword(pw) {
  if (typeof pw !== "string" || !PASSWORD_RE.test(pw))
    return "Password must be 10–128 characters with uppercase, lowercase, a number and a special character.";
  return null;
}

/* Trimmed string or null. Throws a ValidationError when longer than `max`
   (so a caller can turn it into a 400 with the field name). */
class ValidationError extends Error {}
function optStr(v, max, field) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new ValidationError(`${field} is too long (max ${max} characters).`);
  return s;
}

/* Accepts "YYYY-MM-DD", "YYYY-MM-DDTHH:MM[:SS]", or a full ISO string.
   Returns the trimmed original (empty → null) or throws on garbage. */
function optDateTime(v, field) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (s.length > 40 || !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) || Number.isNaN(Date.parse(s.replace(" ", "T"))))
    throw new ValidationError(`${field} is not a valid date/time.`);
  return s;
}

// Phone / WhatsApp number: digits with optional + and separators, 8–15 digits.
// WhatsApp group ids (…@g.us) are accepted as-is.
function optPhone(v, field = "Phone") {
  const s = optStr(v, LIMITS.contact + 30, field);
  if (!s) return null;
  if (/^\d{10,30}@g\.us$/.test(s)) return s;
  const digits = s.replace(/[\s().-]/g, "");
  if (!/^\+?\d{8,15}$/.test(digits))
    throw new ValidationError(`${field} must be a valid phone number (8–15 digits).`);
  return s;
}

const isDate = (s) => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(s));

module.exports = {
  EMAIL_RE,
  TIME_RE,
  DATE_RE,
  LIMITS,
  ValidationError,
  validatePassword,
  optStr,
  optDateTime,
  optPhone,
  isDate,
};
