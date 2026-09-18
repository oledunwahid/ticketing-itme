/* ==========================================================================
   Routes — Import / Export (CSV) for Users, Locations, Schedules

     GET  /api/export/users        (SuperAdmin: all · AdminIT/ME: manageable)
     GET  /api/export/locations    (admins)
     GET  /api/export/schedules    (admins)
     POST /api/import/users        (SuperAdmin only)
     POST /api/import/locations    (SuperAdmin only)
     POST /api/import/schedules    (SuperAdmin only)

   Import contract (JSON body): { csv: string, dryRun?: boolean }
     • dryRun → validate only; returns { summary, errors, preview }, no writes.
     • real import → ALL-OR-NOTHING: if ANY row is invalid the whole import is
       rejected (400) with row errors and nothing is written. Valid imports run
       inside a single transaction (BEGIN/COMMIT, ROLLBACK on error).
   Upsert keys: users→email (update-only), locations→code, schedules→
   (technician + day_of_week + start_time + end_time).
   ========================================================================== */
const express = require("express");
const db = require("../../database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ADMIN_ROLES } = require("../config/constants");
const { deptForRole, canManageTargetRole } = require("../utils/permissions");
const { toCsv, parseCsv } = require("../utils/csv");

const router = express.Router();

const EXPORT_ROLES = ADMIN_ROLES; // SuperAdmin, AdminIT, AdminME
const IMPORT_ROLES = ["SuperAdmin"]; // imports are SuperAdmin-only

const USER_HEADERS = ["username", "email", "role", "department", "phone", "is_active"];
const LOCATION_HEADERS = ["code", "name", "brand_code", "region", "active"];
const SCHEDULE_HEADERS = ["technician_email", "day_of_week", "start_time", "end_time", "active"];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ROWS = 5000;
const dupe = (seen, key, rowNum, label) => {
  if (seen.has(key)) throw new Error(`duplicate ${label} (also on row ${seen.get(key)})`);
  seen.set(key, rowNum);
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const truthy = (v) => /^(1|true|yes|active|y)$/i.test(String(v).trim());
const boolCell = (v, dflt) =>
  v === undefined || v === null || String(v).trim() === "" ? dflt : truthy(v) ? 1 : 0;

// --- CSV download helper ---------------------------------------------------
function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("﻿" + csv); // BOM so Excel opens UTF-8 correctly
}

// ==========================================================================
// EXPORT
// ==========================================================================
router.get("/api/export/users", requireAuth, requireRole(EXPORT_ROLES), async (req, res) => {
  try {
    let rows = await db.pAll(
      "SELECT username, email, role, department, phone, is_active FROM users ORDER BY id ASC",
    );
    // Non-SuperAdmins export only the users they may manage (scoped export).
    if (req.user.role !== "SuperAdmin")
      rows = rows.filter((u) => canManageTargetRole(req.user.role, u.role));
    sendCsv(res, "users.csv", toCsv(USER_HEADERS, rows));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to export users" });
  }
});

router.get("/api/export/locations", requireAuth, requireRole(EXPORT_ROLES), async (req, res) => {
  try {
    const rows = await db.pAll(
      "SELECT code, name, brand_code, region, active FROM outlets ORDER BY code ASC",
    );
    sendCsv(res, "locations.csv", toCsv(LOCATION_HEADERS, rows));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to export locations" });
  }
});

router.get("/api/export/schedules", requireAuth, requireRole(EXPORT_ROLES), async (req, res) => {
  try {
    const rows = await db.pAll(
      `SELECT u.email AS technician_email, s.day_of_week, s.start_time, s.end_time, s.active
         FROM technician_schedules s JOIN users u ON u.id = s.user_id
         ORDER BY u.email ASC, s.day_of_week ASC, s.start_time ASC`,
    );
    sendCsv(res, "schedules.csv", toCsv(SCHEDULE_HEADERS, rows));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to export schedules" });
  }
});

// ==========================================================================
// IMPORT (shared pipeline)
// ==========================================================================
// validateRow(row, rowNum) → prepared object { _action, display, ... } or throws
//   Error(message) for an invalid row.
// applyRows(prepared[]) → performs the writes (runs inside a transaction).
async function handleImport(req, res, moduleName, requiredHeaders, validateRow, applyRows) {
  try {
    const csv = req.body && typeof req.body.csv === "string" ? req.body.csv : "";
    const dryRun = !!(req.body && req.body.dryRun) || req.query.dryRun === "1";
    if (!csv.trim()) return res.status(400).json({ error: "No CSV content provided" });

    if (csv.length > 2 * 1024 * 1024)
      return res.status(413).json({ error: "CSV is too large (max 2 MB)." });
    const { headers, rows } = parseCsv(csv);
    const missing = requiredHeaders.filter((h) => !headers.includes(h));
    if (missing.length)
      return res
        .status(400)
        .json({ error: `Missing required column(s): ${missing.join(", ")}` });
    if (!rows.length) return res.status(400).json({ error: "No data rows found" });
    if (rows.length > MAX_ROWS)
      return res.status(400).json({ error: `Too many rows (${rows.length}). Split the file into batches of ${MAX_ROWS}.` });

    const errors = [];
    const prepared = [];
    const seen = new Map(); // duplicate keys within the same file
    for (let idx = 0; idx < rows.length; idx++) {
      const rowNum = idx + 2; // +1 for header line, +1 for 1-based
      try {
        prepared.push(await validateRow(rows[idx], rowNum, req.user, seen));
      } catch (e) {
        errors.push({ row: rowNum, message: e.message || String(e) });
      }
    }

    const summary = {
      total: rows.length,
      valid: prepared.length,
      invalid: errors.length,
      toInsert: prepared.filter((p) => p._action === "insert").length,
      toUpdate: prepared.filter((p) => p._action === "update").length,
    };
    const preview = prepared
      .slice(0, 50)
      .map((p) => ({ action: p._action, ...p.display }));

    if (dryRun)
      return res.json({ module: moduleName, dryRun: true, summary, errors, preview });

    // Real import — all-or-nothing: reject the whole file if any row is invalid.
    if (errors.length)
      return res.status(400).json({
        module: moduleName,
        dryRun: false,
        error: "Import rejected. Fix the invalid row(s) and try again.",
        summary,
        errors,
        preview,
      });

    try {
      await db.transaction(() => applyRows(prepared));
    } catch (e) {
      console.error(e);
      return res
        .status(500)
        .json({ error: "Import failed and was rolled back. Nothing was changed." });
    }
    summary.applied = prepared.length;
    res.json({ module: moduleName, dryRun: false, summary, errors: [], preview });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Import failed" });
  }
}

// --- Users (update existing by email) --------------------------------------
async function validateUserRow(r, rowNum, actor, seen) {
  const email = (r.email || "").toLowerCase().trim();
  if (!email) throw new Error("email is required");
  if (!EMAIL_RE.test(email)) throw new Error(`invalid email "${email}"`);
  dupe(seen, "e:" + email, rowNum, `email "${email}"`);
  const existing = await db.pGet("SELECT id, role FROM users WHERE LOWER(email) = ?", [email]);
  if (!existing)
    throw new Error(
      `no existing user with email "${email}" (import updates existing users; create new users on the Users page)`,
    );
  const isSelf = existing.id === actor.id;
  const set = {};
  if (r.username) {
    const name = r.username.trim().slice(0, 120);
    const clash = await db.pGet("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?", [name, existing.id]);
    if (clash) throw new Error(`username "${name}" is already used by another account`);
    dupe(seen, "u:" + name.toLowerCase(), rowNum, `username "${name}"`);
    set.username = name;
  }
  if (r.role && r.role !== existing.role) {
    if (!db.APP_ROLES.includes(r.role)) throw new Error(`invalid role "${r.role}"`);
    if (isSelf) throw new Error("you cannot change your own role by import");
    set.role = r.role;
    set.department = deptForRole(r.role);
  } else if (r.department && !r.role) {
    if (!["IT", "ME"].includes(r.department.toUpperCase()))
      throw new Error(`department must be IT or ME (got "${r.department}")`);
    set.department = r.department.toUpperCase();
  }
  if (r.phone !== undefined && r.phone !== "") {
    if (!/^\+?[\d\s().-]{8,25}$/.test(r.phone)) throw new Error(`invalid phone "${r.phone}"`);
    set.phone = r.phone;
  }
  if (r.is_active !== undefined && r.is_active !== "") {
    set.is_active = boolCell(r.is_active, 1);
    if (isSelf && !set.is_active) throw new Error("you cannot deactivate your own account by import");
  }
  if (!Object.keys(set).length) throw new Error("no updatable fields provided");
  return { _action: "update", id: existing.id, set, display: { email, ...set } };
}
async function applyUserRows(prepared) {
  for (const p of prepared) {
    const cols = Object.keys(p.set);
    await db.pRun(
      `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      [...cols.map((c) => p.set[c]), p.id],
    );
    // Role change or deactivation signs the user out everywhere.
    if (p.set.role || p.set.is_active === 0)
      await db.pRun("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?", [p.id]);
  }
}

// --- Locations / outlets (upsert by code) ----------------------------------
async function validateLocationRow(r, rowNum, actor, seen) {
  const code = (r.code || "").trim().toUpperCase();
  if (!code) throw new Error("code is required");
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,29}$/.test(code))
    throw new Error(`code "${code}" may only use letters, numbers and - _ .`);
  dupe(seen, code, rowNum, `code "${code}"`);
  const name = ((r.name || "").trim() || code).slice(0, 100);
  const brand_code = (r.brand_code || "").trim().toUpperCase().slice(0, 30);
  if (!brand_code) throw new Error(`brand_code is required for "${code}"`);
  const region = ((r.region || "").trim() || "Jakarta").slice(0, 40);
  const active = boolCell(r.active, 1);
  const existing = await db.pGet("SELECT id FROM outlets WHERE UPPER(code) = ?", [code]);
  const data = { code, name, brand_code, region, active };
  return { _action: existing ? "update" : "insert", data, display: data };
}
async function applyLocationRows(prepared) {
  for (const p of prepared) {
    const d = p.data;
    await db.pRun("INSERT OR IGNORE INTO brands (code, name) VALUES (?, ?)", [d.brand_code, d.brand_code]);
    if (p._action === "update") {
      await db.pRun(
        "UPDATE outlets SET name = ?, brand_code = ?, region = ?, active = ? WHERE UPPER(code) = ?",
        [d.name, d.brand_code, d.region, d.active, d.code],
      );
    } else {
      await db.pRun(
        "INSERT INTO outlets (code, name, brand_code, display_label, region, active) VALUES (?, ?, ?, ?, ?, ?)",
        [d.code, d.name, d.brand_code, d.code, d.region, d.active],
      );
    }
  }
}

// --- Schedules (upsert by technician + day + start + end) ------------------
async function validateScheduleRow(r, rowNum, actor, seen) {
  const email = (r.technician_email || "").toLowerCase().trim();
  if (!email) throw new Error("technician_email is required");
  const user = await db.pGet("SELECT id, role FROM users WHERE LOWER(email) = ?", [email]);
  if (!user) throw new Error(`no user with email "${email}"`);
  if (!/^Technician(IT|ME)$/.test(user.role))
    throw new Error(`user "${email}" is not a technician (role ${user.role})`);
  const dow = Number(r.day_of_week);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6)
    throw new Error(`day_of_week must be 0-6 (got "${r.day_of_week}")`);
  const start = (r.start_time || "").trim();
  const end = (r.end_time || "").trim();
  if (!TIME_RE.test(start)) throw new Error(`start_time must be HH:MM (got "${start}")`);
  if (!TIME_RE.test(end)) throw new Error(`end_time must be HH:MM (got "${end}")`);
  if (end <= start) throw new Error(`end_time must be after start_time (${start}-${end})`);
  dupe(seen, `${user.id}|${dow}|${start}|${end}`, rowNum, "schedule");
  const active = boolCell(r.active, 1);
  const existing = await db.pGet(
    "SELECT id FROM technician_schedules WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ?",
    [user.id, dow, start, end],
  );
  const data = { user_id: user.id, day_of_week: dow, start_time: start, end_time: end, active };
  return {
    _action: existing ? "update" : "insert",
    id: existing ? existing.id : null,
    data,
    display: { technician_email: email, day_of_week: dow, start_time: start, end_time: end, active },
  };
}
async function applyScheduleRows(prepared) {
  for (const p of prepared) {
    const d = p.data;
    if (p._action === "update") {
      await db.pRun("UPDATE technician_schedules SET active = ? WHERE id = ?", [d.active, p.id]);
    } else {
      await db.pRun(
        "INSERT INTO technician_schedules (user_id, day_of_week, start_time, end_time, active) VALUES (?, ?, ?, ?, ?)",
        [d.user_id, d.day_of_week, d.start_time, d.end_time, d.active],
      );
    }
  }
}

router.post("/api/import/users", requireAuth, requireRole(IMPORT_ROLES), (req, res) =>
  handleImport(req, res, "users", ["email"], validateUserRow, applyUserRows),
);
router.post("/api/import/locations", requireAuth, requireRole(IMPORT_ROLES), (req, res) =>
  handleImport(req, res, "locations", ["code", "name", "brand_code"], validateLocationRow, applyLocationRows),
);
router.post("/api/import/schedules", requireAuth, requireRole(IMPORT_ROLES), (req, res) =>
  handleImport(
    req,
    res,
    "schedules",
    ["technician_email", "day_of_week", "start_time", "end_time"],
    validateScheduleRow,
    applyScheduleRows,
  ),
);

module.exports = router;
