/* ==========================================================================
   Util — dependency-free CSV (RFC-4180-ish)

   toCsv(headers, records) → CSV string (CRLF line endings). Values containing
   commas, quotes, or newlines are quoted; embedded quotes are doubled.

   parseCsv(text) → { headers: string[], rows: Array<Record<string,string>> }
   Handles quoted fields, embedded commas/newlines, doubled quotes, a leading
   BOM, and CRLF/LF. Header and cell values are trimmed. Fully-empty lines are
   skipped so a trailing newline does not produce a phantom row.

   No third-party dependency — kept intentionally small (the app avoids adding
   heavy packages just for CSV).
   ========================================================================== */

function toCsv(headers, records) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const rec of records) lines.push(headers.map((h) => esc(rec[h])).join(","));
  return lines.join("\r\n");
}

function parseCsv(text) {
  const s = String(text == null ? "" : text).replace(/^﻿/, ""); // strip BOM
  const records = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { records.push(row); row = []; };
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { pushField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { pushField(); pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }

  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] !== undefined ? r[idx] : "").trim(); });
    return obj;
  });
  return { headers, rows };
}

module.exports = { toCsv, parseCsv };
