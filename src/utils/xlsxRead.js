/* ==========================================================================
   Util: dependency-free XLSX reader (the counterpart of utils/xlsx.js)

   readXlsx(buffer) → [{ name, rows: [{ r, cells: string[] }] }]
     • one entry per worksheet, in workbook order
     • r is the 1-based Excel row number (blank rows are skipped, so row
       numbers in error messages match what the user sees in Excel)
     • every cell comes back as a string: shared / inline strings as text,
       numbers as written in the file ("812345678", "0.375"), booleans "1"/"0"

   Reads only what an import needs. Formulas return their cached value; styles,
   dates and number formats are not interpreted (callers convert when needed).
   ========================================================================== */
const zlib = require("zlib");

const MAX_TOTAL = 50 * 1024 * 1024; // uncompressed bytes, guards against zip bombs

class XlsxError extends Error {}

// ---- ZIP ------------------------------------------------------------------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError("Not an Excel .xlsx file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError("The .xlsx file is damaged.");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (!/\.(xml|rels)$/i.test(name)) continue; // images, printer settings…
    total += size;
    if (total > MAX_TOTAL) throw new XlsxError("The .xlsx file is too large once unpacked.");
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) throw new XlsxError("The .xlsx file is damaged.");
    const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const data = buf.subarray(start, start + compSize);
    let out;
    if (method === 0) out = data;
    else if (method === 8) out = zlib.inflateRawSync(data, { maxOutputLength: MAX_TOTAL });
    else throw new XlsxError("The .xlsx file uses an unsupported compression method.");
    files.set(name.replace(/^\//, ""), out.toString("utf8"));
  }
  return files;
}

// ---- XML helpers ------------------------------------------------------------
const unescapeXml = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/_x([0-9A-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? unescapeXml(m[1]) : null;
};

// Text of a <si> / <is> node: all <t> runs, minus phonetic (<rPh>) hints.
const richText = (xml) =>
  xml
    .replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")
    .match(/<t\b[^>]*>[\s\S]*?<\/t>|<t\b[^>]*\/>/g)
    ?.map((t) => unescapeXml(t.replace(/^<t\b[^>]*>|<\/t>$|^<t\b[^>]*\/>$/g, "")))
    .join("") ?? "";

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || "");
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---- Workbook -----------------------------------------------------------------
function readXlsx(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new XlsxError("Not an Excel .xlsx file.");
  const files = unzip(buf);
  const workbook = files.get("xl/workbook.xml");
  if (!workbook) throw new XlsxError("Not an Excel .xlsx file (no workbook found).");

  const rels = new Map();
  for (const m of (files.get("xl/_rels/workbook.xml.rels") || "").matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], "Id");
    let target = attr(m[1], "Target") || "";
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    rels.set(id, target.replace(/\/\.\//g, "/"));
  }

  const shared = [];
  for (const m of (files.get("xl/sharedStrings.xml") || "").matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? richText(m[1]) : "");

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], "name");
    const xml = files.get(rels.get(attr(m[1], "r:id")));
    if (!name || !xml) continue;
    const rows = [];
    let nextRow = 1;
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(attr(rm[1], "r")) || nextRow;
      nextRow = r + 1;
      const cells = [];
      let nextCol = 0;
      for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], "r");
        const ci = ref ? colIndex(ref) : nextCol;
        nextCol = ci + 1;
        const type = attr(cm[1], "t");
        const body = cm[2] || "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        let value = "";
        if (type === "s") value = v ? shared[Number(v[1])] ?? "" : "";
        else if (type === "inlineStr") value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] || "");
        else if (type === "e") value = "";
        else value = v ? unescapeXml(v[1]) : "";
        if (ci >= 0 && ci < 200) cells[ci] = value;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
      if (cells.some((c) => String(c).trim() !== "")) rows.push({ r, cells });
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

module.exports = { readXlsx, XlsxError };
