/* ==========================================================================
   Routes: Import / Export of master data (Excel workbook or CSV per sheet)

     GET  /api/export/template      empty workbook to fill in (admins)
     GET  /api/export/workbook      every sheet with current data (admins)
     GET  /api/export/:module       one sheet as CSV (admins)
     POST /api/import/workbook      { file: base64 .xlsx, dryRun? } (SuperAdmin)
     POST /api/import/:module       { csv: string, dryRun? }        (SuperAdmin)

   Modules, in the order they are validated and written:
     brands → locations → categories → users → schedules → user outlets
   so a single workbook can create a brand, its outlets, the technicians and
   their schedules / outlet coverage in one go.

   Imports are ALL-OR-NOTHING: dryRun validates and previews without writing;
   a real import is rejected (400) if any row in any sheet is invalid, and
   valid imports run in one transaction (ROLLBACK on error).

   Upsert keys: brands→code, locations→code, categories→(department, name),
   users→email, schedules→(technician, day, start, end),
   user outlets→(user, outlet). Nothing is ever deleted by an import.
   ========================================================================== */
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ADMIN_ROLES, REGIONS } = require("../config/constants");
const { deptForRole, canManageTargetRole } = require("../utils/permissions");
const { EMAIL_RE, TIME_RE, validatePassword } = require("../utils/validate");
const { toCsv, parseCsv } = require("../utils/csv");
const { buildXlsx } = require("../utils/xlsx");
const { readXlsx, XlsxError } = require("../utils/xlsxRead");

const router = express.Router();

const EXPORT_ROLES = ADMIN_ROLES; // SuperAdmin, AdminIT, AdminME
const IMPORT_ROLES = ["SuperAdmin"]; // imports are SuperAdmin-only
const MAX_ROWS = 5000; // per sheet
const CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{0,29}$/;
const PHONE_RE = /^\+?[\d\s().-]{8,25}$/;
const DAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
const truthy = (v) => /^(1|true|yes|y|active)$/i.test(str(v));
const falsy = (v) => /^(0|false|no|n|inactive)$/i.test(str(v));
function flag(v, dflt, field) {
  if (str(v) === "") return dflt;
  if (truthy(v)) return 1;
  if (falsy(v)) return 0;
  throw new Error(`${field} must be 1 or 0 (got "${str(v)}")`);
}
const dupe = (seen, key, rowNum, label) => {
  if (seen.has(key)) throw new Error(`duplicate ${label} (also on row ${seen.get(key)})`);
  seen.set(key, rowNum);
};
function code(v, field) {
  const c = str(v).toUpperCase();
  if (!c) throw new Error(`${field} is required`);
  if (!CODE_RE.test(c)) throw new Error(`${field} "${c}" may only use letters, numbers and - _ . (max 30)`);
  return c;
}
// "09:00", "9:00", "9.00" or an Excel time (a fraction of a day, e.g. 0.375).
function time(v, field) {
  const s = str(v);
  let hh, mm;
  const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(s);
  if (/^0?\.\d+$|^0$/.test(s)) {
    // Excel stores a time cell as a fraction of a day.
    const mins = Math.round(Number(s) * 24 * 60);
    [hh, mm] = [Math.floor(mins / 60), mins % 60];
  } else if (m) [hh, mm] = [Number(m[1]), Number(m[2])];
  else throw new Error(`${field} must be HH:MM (got "${s}")`);
  const out = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  if (!TIME_RE.test(out)) throw new Error(`${field} must be HH:MM (got "${s}")`);
  return out;
}
function day(v) {
  const s = str(v).toLowerCase();
  if (/^[0-6]$/.test(s)) return Number(s);
  if (s in DAYS) return DAYS[s];
  throw new Error(`day must be Mon-Sun or 0-6 (got "${str(v)}")`);
}
function region(v) {
  const r = str(v);
  if (!r) return null;
  const hit = REGIONS.find((x) => x.toLowerCase() === r.toLowerCase());
  if (!hit) throw new Error(`region must be one of ${REGIONS.join(", ")} (got "${r}")`);
  return hit;
}

// A technician by email: one created/changed earlier in this import, or in the DB.
async function technician(email, ctx) {
  if (!email) throw new Error("technician_email is required");
  const pending = ctx.users.get(email);
  const row = pending ? null : await db.pGet("SELECT id, role FROM users WHERE LOWER(email) = ?", [email]);
  const role = pending ? pending.role : row && row.role;
  if (!role) throw new Error(`no user with email "${email}" (add them on the Users sheet)`);
  if (!/^Technician(IT|ME)$/.test(role)) throw new Error(`"${email}" is not a technician (role ${role})`);
  return { id: pending ? pending.id : row.id };
}
const userId = async (email) => (await db.pGet("SELECT id FROM users WHERE LOWER(email) = ?", [email])).id;

// ==========================================================================
// Modules
// ==========================================================================
// columns: key = header in row 1 · type 'text' keeps Excel from mangling
// codes, phones and times · note / example feed the README sheet.
const MODULES = [
  {
    key: "brands",
    sheet: "Brands",
    about: "Brands that outlets belong to.",
    columns: [
      { key: "code", required: true, type: "text", width: 12, note: "Short unique code. Letters, numbers, - _ .", example: "UNION" },
      { key: "name", required: true, width: 30, note: "Display name", example: "Union Group" },
      { key: "active", width: 9, note: "1 = active, 0 = hidden. Blank = 1", example: "1" },
    ],
    exportRows: () => db.pAll("SELECT code, name, active FROM brands ORDER BY code"),
    async validate(r, rowNum, ctx, seen) {
      const c = code(r.code, "code");
      dupe(seen, c, rowNum, `code "${c}"`);
      const name = str(r.name).slice(0, 100);
      if (!name) throw new Error("name is required");
      const data = { code: c, name, active: flag(r.active, 1, "active") };
      ctx.brands.add(c);
      const existing = await db.pGet("SELECT id FROM brands WHERE UPPER(code) = ?", [c]);
      return { _action: existing ? "update" : "insert", data, display: data };
    },
    async apply(p) {
      const d = p.data;
      if (p._action === "update") await db.pRun("UPDATE brands SET name = ?, active = ? WHERE UPPER(code) = ?", [d.name, d.active, d.code]);
      else await db.pRun("INSERT INTO brands (code, name, active) VALUES (?, ?, ?)", [d.code, d.name, d.active]);
    },
  },
  {
    key: "locations",
    sheet: "Locations",
    about: "Outlets / sites where issues are reported.",
    columns: [
      { key: "code", required: true, type: "text", width: 12, note: "Short unique outlet code", example: "UTP" },
      { key: "name", required: true, width: 32, note: "Outlet name", example: "Union Tunjungan Plaza" },
      { key: "brand_code", required: true, type: "text", width: 12, note: "A code from the Brands sheet (or already in the app)", example: "UNION" },
      { key: "region", width: 12, note: `One of: ${REGIONS.join(", ")}. Blank = ${REGIONS[0]}`, example: "Surabaya" },
      { key: "active", width: 9, note: "1 = active, 0 = hidden. Blank = 1", example: "1" },
    ],
    exportRows: () => db.pAll("SELECT code, name, brand_code, region, active FROM outlets ORDER BY code"),
    async validate(r, rowNum, ctx, seen) {
      const c = code(r.code, "code");
      dupe(seen, c, rowNum, `code "${c}"`);
      const name = str(r.name).slice(0, 100);
      if (!name) throw new Error("name is required");
      const brand = code(r.brand_code, "brand_code");
      if (!ctx.brands.has(brand) && !(await db.pGet("SELECT 1 FROM brands WHERE UPPER(code) = ?", [brand])))
        throw new Error(`unknown brand_code "${brand}" (add it on the Brands sheet)`);
      const data = { code: c, name, brand_code: brand, region: region(r.region) || REGIONS[0], active: flag(r.active, 1, "active") };
      ctx.outlets.add(c);
      const existing = await db.pGet("SELECT id FROM outlets WHERE UPPER(code) = ?", [c]);
      return { _action: existing ? "update" : "insert", data, display: data };
    },
    async apply(p) {
      const d = p.data;
      if (p._action === "update")
        await db.pRun("UPDATE outlets SET name = ?, brand_code = ?, region = ?, active = ? WHERE UPPER(code) = ?", [d.name, d.brand_code, d.region, d.active, d.code]);
      else
        await db.pRun("INSERT INTO outlets (code, name, brand_code, display_label, region, active) VALUES (?, ?, ?, ?, ?, ?)", [d.code, d.name, d.brand_code, d.code, d.region, d.active]);
    },
  },
  {
    key: "categories",
    sheet: "Categories",
    about: "What people pick when they report an issue.",
    columns: [
      { key: "department", required: true, type: "text", width: 12, note: "IT (or ME)", example: "IT" },
      { key: "name", required: true, width: 28, note: "Category name, max 60 characters", example: "POS System" },
      { key: "sort_order", width: 11, note: "Lower shows first. Blank = 0", example: "10" },
      { key: "active", width: 9, note: "1 = shown on the report form, 0 = hidden. Blank = 1", example: "1" },
    ],
    exportRows: () => db.pAll("SELECT department_code AS department, name, sort_order, active FROM categories ORDER BY department_code, sort_order, name"),
    async validate(r, rowNum, ctx, seen) {
      const dept = str(r.department).toUpperCase();
      if (!["IT", "ME"].includes(dept)) throw new Error(`department must be IT or ME (got "${str(r.department)}")`);
      const name = str(r.name);
      if (!name) throw new Error("name is required");
      if (name.length > 60) throw new Error("name is longer than 60 characters");
      dupe(seen, `${dept}|${name.toLowerCase()}`, rowNum, `category "${name}"`);
      const sort = str(r.sort_order) === "" ? 0 : Number(r.sort_order);
      if (!Number.isInteger(sort)) throw new Error(`sort_order must be a whole number (got "${str(r.sort_order)}")`);
      const data = { department: dept, name, sort_order: sort, active: flag(r.active, 1, "active") };
      const existing = await db.pGet("SELECT id FROM categories WHERE department_code = ? AND LOWER(name) = LOWER(?)", [dept, name]);
      return { _action: existing ? "update" : "insert", id: existing && existing.id, data, display: data };
    },
    async apply(p) {
      const d = p.data;
      if (p._action === "update")
        await db.pRun("UPDATE categories SET name = ?, sort_order = ?, active = ? WHERE id = ?", [d.name, d.sort_order, d.active, p.id]);
      else
        await db.pRun("INSERT INTO categories (department_code, name, sort_order, active) VALUES (?, ?, ?, ?)", [d.department, d.name, d.sort_order, d.active]);
    },
  },
  {
    key: "users",
    sheet: "Users",
    about: "Accounts. New emails are created; existing emails are updated (blank cells keep the current value). Passwords of existing users are never changed by an import.",
    columns: [
      { key: "email", required: true, type: "text", width: 30, note: "Work email, used to sign in", example: "budi@company.com" },
      { key: "username", required: true, width: 22, note: "Display name, must be unique", example: "Budi Santoso" },
      { key: "role", required: true, type: "text", width: 15, note: `One of: ${db.APP_ROLES.join(", ")}`, example: "TechnicianIT" },
      { key: "phone", type: "text", width: 16, note: "WhatsApp number, digits (keep the leading 0)", example: "081234567890" },
      { key: "region", width: 12, note: `One of: ${REGIONS.join(", ")}`, example: "Jakarta" },
      { key: "all_outlets", width: 11, note: "Technicians: 1 = covers every outlet. Blank = 0", example: "0" },
      { key: "is_active", width: 10, note: "1 = can sign in, 0 = blocked. Blank = 1", example: "1" },
      { key: "initial_password", type: "text", width: 18, note: "New users only: 10+ chars with upper, lower, number and symbol. Delete this column's values after importing", example: "Welcome#2026" },
    ],
    async exportRows(actor) {
      let rows = await db.pAll("SELECT email, username, role, phone, region, all_outlets, is_active FROM users ORDER BY id");
      if (actor.role !== "SuperAdmin") rows = rows.filter((u) => canManageTargetRole(actor.role, u.role));
      return rows;
    },
    async validate(r, rowNum, ctx, seen) {
      const email = str(r.email).toLowerCase();
      if (!email) throw new Error("email is required");
      if (!EMAIL_RE.test(email) || email.length > 254) throw new Error(`invalid email "${email}"`);
      dupe(seen, "e:" + email, rowNum, `email "${email}"`);
      const existing = await db.pGet("SELECT id, role FROM users WHERE LOWER(email) = ?", [email]);
      const isSelf = existing && existing.id === ctx.actor.id;

      const set = {};
      const name = str(r.username).slice(0, 120);
      if (name) {
        const clash = await db.pGet("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?", [name, existing ? existing.id : 0]);
        if (clash) throw new Error(`username "${name}" is already used by another account`);
        dupe(seen, "u:" + name.toLowerCase(), rowNum, `username "${name}"`);
        set.username = name;
      }
      const role = str(r.role);
      if (role) {
        if (!db.APP_ROLES.includes(role)) throw new Error(`invalid role "${role}"`);
        if (isSelf && role !== existing.role) throw new Error("you cannot change your own role by import");
        set.role = role;
        set.department = deptForRole(role);
      }
      if (str(r.phone)) {
        if (!PHONE_RE.test(str(r.phone))) throw new Error(`invalid phone "${str(r.phone)}"`);
        set.phone = str(r.phone);
      }
      if (str(r.region)) set.region = region(r.region);
      if (str(r.all_outlets)) set.all_outlets = flag(r.all_outlets, 0, "all_outlets");
      if (str(r.is_active)) {
        set.is_active = flag(r.is_active, 1, "is_active");
        if (isSelf && !set.is_active) throw new Error("you cannot deactivate your own account by import");
      }

      if (existing) {
        ctx.users.set(email, { id: existing.id, role: set.role || existing.role });
        if (!Object.keys(set).length) throw new Error("nothing to update (fill at least one column besides email)");
        return { _action: "update", id: existing.id, set, display: { email, ...set, department: undefined } };
      }
      if (!set.username) throw new Error("username is required for a new user");
      if (!set.role) throw new Error("role is required for a new user");
      const pw = str(r.initial_password);
      if (!pw) throw new Error("initial_password is required for a new user");
      const pwErr = validatePassword(pw);
      if (pwErr) throw new Error(pwErr);
      ctx.users.set(email, { id: null, role: set.role });
      return { _action: "insert", email, set, password: pw, display: { email, ...set, department: undefined } };
    },
    async apply(p) {
      if (p._action === "update") {
        const cols = Object.keys(p.set);
        await db.pRun(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => p.set[c]), p.id]);
        // Role change or deactivation signs the user out everywhere.
        if (p.set.role || p.set.is_active === 0)
          await db.pRun("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?", [p.id]);
        return;
      }
      const s = p.set;
      await db.pRun(
        `INSERT INTO users (username, email, password_hash, role, department, phone, region, all_outlets, all_brands, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.username, p.email, await bcrypt.hash(p.password, 10), s.role, s.department, s.phone || null, s.region || null,
          s.all_outlets || 0,
          s.role === "Requestor" ? 0 : 1, // requestors are limited to their User outlets rows
          s.is_active === 0 ? 0 : 1,
        ],
      );
    },
  },
  {
    key: "schedules",
    sheet: "Schedules",
    about: "Technician working hours, one row per day and time block.",
    columns: [
      { key: "technician_email", required: true, type: "text", width: 30, note: "Email of a technician (Users sheet or already in the app)", example: "budi@company.com" },
      { key: "day", required: true, type: "text", width: 8, note: "Mon, Tue, Wed, Thu, Fri, Sat, Sun (or 0 = Sun ... 6 = Sat)", example: "Mon" },
      { key: "start_time", required: true, type: "text", width: 11, note: "24-hour HH:MM", example: "09:00" },
      { key: "end_time", required: true, type: "text", width: 11, note: "24-hour HH:MM, after start_time", example: "18:00" },
      { key: "active", width: 9, note: "1 = active, 0 = paused. Blank = 1", example: "1" },
    ],
    async exportRows() {
      const rows = await db.pAll(
        `SELECT u.email AS technician_email, s.day_of_week, s.start_time, s.end_time, s.active
           FROM technician_schedules s JOIN users u ON u.id = s.user_id
          ORDER BY u.email, s.day_of_week, s.start_time`,
      );
      return rows.map((r) => ({ ...r, day: DAY_NAMES[r.day_of_week] }));
    },
    async validate(r, rowNum, ctx, seen) {
      const email = str(r.technician_email).toLowerCase();
      const tech = await technician(email, ctx);
      // older CSV exports call the column day_of_week
      const dow = day(str(r.day) !== "" ? r.day : r.day_of_week);
      const start = time(r.start_time, "start_time");
      const end = time(r.end_time, "end_time");
      if (end <= start) throw new Error(`end_time must be after start_time (${start}-${end})`);
      dupe(seen, `${email}|${dow}|${start}|${end}`, rowNum, "schedule");
      const active = flag(r.active, 1, "active");
      const existing = tech.id && await db.pGet(
        "SELECT id FROM technician_schedules WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ?",
        [tech.id, dow, start, end],
      );
      return {
        _action: existing ? "update" : "insert",
        id: existing && existing.id,
        data: { email, day_of_week: dow, start_time: start, end_time: end, active },
        display: { technician_email: email, day: DAY_NAMES[dow], start_time: start, end_time: end, active },
      };
    },
    async apply(p) {
      const d = p.data;
      if (p._action === "update") await db.pRun("UPDATE technician_schedules SET active = ? WHERE id = ?", [d.active, p.id]);
      else
        await db.pRun(
          "INSERT INTO technician_schedules (user_id, day_of_week, start_time, end_time, active) VALUES (?, ?, ?, ?, ?)",
          [await userId(d.email), d.day_of_week, d.start_time, d.end_time, d.active],
        );
    },
  },
  {
    key: "coverage",
    sheet: "User outlets",
    about: "Outlets per user. Technicians: the outlets they cover (PIC), not needed with all_outlets = 1. Requestors: the outlets they may report for.",
    columns: [
      { key: "user_email", required: true, type: "text", width: 30, note: "Email from the Users sheet (or already in the app)", example: "budi@company.com" },
      { key: "outlet_code", required: true, type: "text", width: 12, note: "A code from the Locations sheet", example: "UTP" },
    ],
    exportRows: () =>
      db.pAll(
        `SELECT u.email AS user_email, a.outlet_code
           FROM user_outlet_access a JOIN users u ON u.id = a.user_id
          ORDER BY u.email, a.outlet_code`,
      ),
    async validate(r, rowNum, ctx, seen) {
      const email = str(r.user_email).toLowerCase();
      if (!email) throw new Error("user_email is required");
      const pending = ctx.users.get(email);
      const row = pending ? null : await db.pGet("SELECT id FROM users WHERE LOWER(email) = ?", [email]);
      if (!pending && !row) throw new Error(`no user with email "${email}" (add them on the Users sheet)`);
      const uid = pending ? pending.id : row.id;
      const oc = code(r.outlet_code, "outlet_code");
      if (!ctx.outlets.has(oc) && !(await db.pGet("SELECT 1 FROM outlets WHERE UPPER(code) = ?", [oc])))
        throw new Error(`unknown outlet_code "${oc}" (add it on the Locations sheet)`);
      dupe(seen, `${email}|${oc}`, rowNum, "user + outlet");
      const existing = uid && await db.pGet("SELECT 1 FROM user_outlet_access WHERE user_id = ? AND UPPER(outlet_code) = ?", [uid, oc]);
      const data = { user_email: email, outlet_code: oc };
      return { _action: existing ? "update" : "insert", data, display: data };
    },
    async apply(p) {
      if (p._action === "insert")
        await db.pRun("INSERT OR IGNORE INTO user_outlet_access (user_id, outlet_code) VALUES (?, ?)", [await userId(p.data.user_email), p.data.outlet_code]);
    },
  },
];
const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));
const headersOf = (m) => m.columns.map((c) => c.key);

// ==========================================================================
// Import pipeline
// ==========================================================================
// sets: [{ module, headers, rows: [{ _row, ...cells }] }] in MODULES order.
async function validateSets(sets, actor) {
  const ctx = { actor, brands: new Set(), outlets: new Set(), users: new Map() };
  const results = [];
  for (const { module: m, headers, rows } of sets) {
    const errors = [];
    const prepared = [];
    const missing = m.columns.filter((c) => c.required && !headers.includes(c.key)).map((c) => c.key);
    // Old schedule CSVs use day_of_week instead of day.
    if (m.key === "schedules" && missing.includes("day") && headers.includes("day_of_week")) missing.splice(missing.indexOf("day"), 1);
    if (missing.length) errors.push({ row: 1, message: `missing column(s): ${missing.join(", ")}` });
    else if (rows.length > MAX_ROWS) errors.push({ row: 1, message: `too many rows (${rows.length}); split into batches of ${MAX_ROWS}` });
    else {
      const seen = new Map();
      for (const row of rows) {
        try {
          prepared.push(await m.validate(row, row._row, ctx, seen));
        } catch (e) {
          errors.push({ row: row._row, message: e.message || String(e) });
        }
      }
    }
    results.push({
      module: m,
      prepared,
      out: {
        key: m.key,
        sheet: m.sheet,
        summary: {
          total: rows.length,
          valid: prepared.length,
          invalid: errors.length,
          toInsert: prepared.filter((p) => p._action === "insert").length,
          toUpdate: prepared.filter((p) => p._action === "update").length,
        },
        errors: errors.slice(0, 500),
        preview: prepared.slice(0, 50).map((p) => ({ action: p._action, ...JSON.parse(JSON.stringify(p.display)) })),
      },
    });
  }
  return results;
}

async function runImport(req, res, sets, shape) {
  const dryRun = !!(req.body && req.body.dryRun) || req.query.dryRun === "1";
  if (!sets.some((s) => s.rows.length)) return res.status(400).json({ error: "No data rows found" });
  const results = await validateSets(sets, req.user);
  const summary = { total: 0, valid: 0, invalid: 0, toInsert: 0, toUpdate: 0 };
  for (const r of results) for (const k of Object.keys(summary)) summary[k] += r.out.summary[k];
  const body = shape(results.map((r) => r.out), summary);

  if (dryRun) return res.json({ ...body, dryRun: true });
  if (summary.invalid)
    return res.status(400).json({ ...body, dryRun: false, error: "Import rejected. Fix the invalid row(s) and try again." });
  try {
    await db.transaction(async () => {
      for (const r of results) for (const p of r.prepared) await r.module.apply(p);
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Import failed and was rolled back. Nothing was changed." });
  }
  summary.applied = summary.valid;
  for (const r of results) r.out.summary.applied = r.out.summary.valid;
  res.json({ ...shape(results.map((r) => r.out), summary), dryRun: false });
}

const normHeader = (h) => str(h).toLowerCase().replace(/\s*\(.*\)\s*$/, "").replace(/\s*\*$/, "").replace(/\s+/g, "_");

// --- POST /api/import/workbook -----------------------------------------------
router.post("/api/import/workbook", requireAuth, requireRole(IMPORT_ROLES), async (req, res) => {
  try {
    const b64 = req.body && typeof req.body.file === "string" ? req.body.file : "";
    if (!b64) return res.status(400).json({ error: "No file provided" });
    let sheets;
    try {
      sheets = readXlsx(Buffer.from(b64, "base64"));
    } catch (e) {
      if (e instanceof XlsxError) return res.status(400).json({ error: e.message });
      throw e;
    }
    const byName = new Map(sheets.map((s) => [s.name.trim().toLowerCase(), s]));
    const sets = [];
    for (const m of MODULES) {
      const sh = byName.get(m.sheet.toLowerCase()) || byName.get(m.key);
      if (!sh || sh.rows.length === 0) continue;
      const [head, ...data] = sh.rows;
      const headers = head.cells.map(normHeader);
      const rows = data.map(({ r, cells }) => {
        const o = { _row: r };
        headers.forEach((h, i) => { if (h) o[h] = cells[i] ?? ""; });
        return o;
      });
      if (rows.length) sets.push({ module: m, headers, rows });
    }
    if (!sets.length)
      return res.status(400).json({ error: `No data found. Fill at least one of these sheets: ${MODULES.map((m) => m.sheet).join(", ")}.` });
    await runImport(req, res, sets, (modules, summary) => ({ module: "workbook", summary, modules }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Import failed" });
  }
});

// --- POST /api/import/:module (CSV) --------------------------------------------
router.post("/api/import/:module", requireAuth, requireRole(IMPORT_ROLES), async (req, res) => {
  const m = MODULE_BY_KEY.get(req.params.module);
  if (!m) return res.status(404).json({ error: "Unknown import type" });
  try {
    const csv = req.body && typeof req.body.csv === "string" ? req.body.csv : "";
    if (!csv.trim()) return res.status(400).json({ error: "No CSV content provided" });
    if (csv.length > 2 * 1024 * 1024) return res.status(413).json({ error: "CSV is too large (max 2 MB)." });
    const { headers, rows } = parseCsv(csv);
    const norm = headers.map(normHeader);
    const data = rows.map((row, i) => {
      const o = { _row: i + 2 };
      headers.forEach((h, j) => { o[norm[j]] = row[h]; });
      return o;
    });
    await runImport(req, res, [{ module: m, headers: norm, rows: data }], (modules) => ({ module: m.key, ...modules[0] }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Import failed" });
  }
});

// ==========================================================================
// Export
// ==========================================================================
function readmeSheet() {
  const rows = [];
  for (const m of MODULES) {
    rows.push({ sheet: m.sheet, column: "", required: "", note: m.about, example: "" });
    for (const c of m.columns)
      rows.push({ sheet: "", column: c.key, required: c.required ? "yes" : "", note: c.note, example: c.example });
  }
  return {
    name: "README",
    title: "IT Ticketing master data",
    subtitle:
      "Fill the sheets you need and keep row 1 of each sheet as is. Blank sheets are skipped. " +
      "Upload the file on Import / Export: you get a preview first, and nothing is saved until every row is valid.",
    freeze: false,
    columns: [
      { header: "Sheet", key: "sheet", width: 20 },
      { header: "Column", key: "column", width: 18 },
      { header: "Required", key: "required", width: 10 },
      { header: "What to enter", key: "note", width: 80 },
      { header: "Example", key: "example", width: 22 },
    ],
    rows,
  };
}

async function sendWorkbook(res, actor, withData) {
  const sheets = [readmeSheet()];
  for (const m of MODULES) {
    sheets.push({
      name: m.sheet,
      columns: m.columns.map((c) => ({ header: c.key, key: c.key, type: c.type === "text" ? "text" : undefined, width: c.width })),
      rows: withData ? await m.exportRows(actor) : [],
    });
  }
  const name = withData ? `master_data_${new Date().toISOString().slice(0, 10)}.xlsx` : "master_data_template.xlsx";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(buildXlsx(sheets, { title: "IT Ticketing master data" }));
}

router.get("/api/export/template", requireAuth, requireRole(EXPORT_ROLES), async (req, res) => {
  try {
    await sendWorkbook(res, req.user, false);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to build the template" });
  }
});

router.get("/api/export/workbook", requireAuth, requireRole(EXPORT_ROLES), async (req, res) => {
  try {
    await sendWorkbook(res, req.user, true);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to export" });
  }
});

router.get("/api/export/:module", requireAuth, requireRole(EXPORT_ROLES), async (req, res) => {
  const m = MODULE_BY_KEY.get(req.params.module);
  if (!m) return res.status(404).json({ error: "Unknown export type" });
  try {
    const rows = await m.exportRows(req.user);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${m.key}.csv"`);
    res.send("﻿" + toCsv(headersOf(m), rows)); // BOM so Excel opens UTF-8 correctly
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: `Failed to export ${m.key}` });
  }
});

module.exports = router;
module.exports._internal = { MODULES };
