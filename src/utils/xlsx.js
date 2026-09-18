/* ==========================================================================
   Util — dependency-free XLSX writer (Office Open XML SpreadsheetML)

   buildXlsx(sheets, { title, creator }) → Buffer
     sheets: [{ name, columns: [{ header, key, type, width }], rows: [obj],
                title?: string, freeze?: true }]
     column.type: 'string' | 'text' | 'int' | 'number' | 'percent' | 'datetime' | 'date'
                  | 'typed' (use row.type, for mixed-format summary tables)
       • text formats the whole column as Text (@), so values typed later in
         Excel keep leading zeros (phones, codes) and are not turned into dates
       • percent values are fractions (0.873 → 87.3%)
       • datetime/date accept Date, epoch ms, or ISO/SQLite strings

   Uses inline strings (no shared-string table) and a tiny ZIP container built
   on node:zlib — enough for Excel, LibreOffice, Google Sheets and Numbers.
   ========================================================================== */
const zlib = require("zlib");

// ---- ZIP ------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
function zip(files) {
  const now = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const packed = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---- SpreadsheetML ----------------------------------------------------------
const esc = (s) =>
  String(s)
    // characters XML 1.0 cannot carry at all
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colName(i) {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// Style ids (see STYLES below)
const S = { text: 0, header: 1, int: 2, number: 3, percent: 4, datetime: 5, title: 6, date: 7, subtle: 8, textfmt: 9 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF5F6B80"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// Excel serial date in the server's local time zone.
function toSerial(v) {
  if (v == null || v === "") return null;
  let ms;
  if (v instanceof Date) ms = v.getTime();
  else if (typeof v === "number") ms = v;
  else {
    const s = String(v).trim();
    // SQLite "YYYY-MM-DD HH:MM:SS" is UTC; zoned ISO parses as-is;
    // "YYYY-MM-DDTHH:MM" (datetime-local input) is local wall time.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) ms = Date.parse(s.replace(" ", "T") + "Z");
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) ms = Date.parse(s + "T00:00");
    else ms = Date.parse(s);
  }
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return local / 86400000 + 25569;
}

function cell(ref, value, type) {
  if (value === null || value === undefined || value === "") return "";
  if (type === "int" || type === "number" || type === "percent") {
    const n = Number(value);
    if (!Number.isFinite(n)) return `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
    const style = type === "int" ? S.int : type === "percent" ? S.percent : S.number;
    return `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
  }
  if (type === "datetime" || type === "date") {
    const serial = toSerial(value);
    if (serial == null) return "";
    return `<c r="${ref}" s="${type === "date" ? S.date : S.datetime}"><v>${serial}</v></c>`;
  }
  let s = String(value);
  if (s.length > 32000) s = s.slice(0, 32000);
  const style = type === "text" ? ` s="${S.textfmt}"` : "";
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
}

function sheetXml(sheet) {
  const cols = sheet.columns;
  const rowsXml = [];
  let r = 1;
  const pre = [];
  if (sheet.title) {
    pre.push(`<row r="${r}"><c r="A${r}" s="${S.title}" t="inlineStr"><is><t>${esc(sheet.title)}</t></is></c></row>`);
    r++;
    if (sheet.subtitle) {
      pre.push(`<row r="${r}"><c r="A${r}" s="${S.subtle}" t="inlineStr"><is><t>${esc(sheet.subtitle)}</t></is></c></row>`);
      r++;
    }
    r++; // blank spacer row
  }
  const headerRow = r;
  rowsXml.push(
    `<row r="${r}">${cols.map((c, i) => `<c r="${colName(i)}${r}" s="${S.header}" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`).join("")}</row>`,
  );
  for (const row of sheet.rows) {
    r++;
    rowsXml.push(
      `<row r="${r}">${cols
        .map((c, i) => cell(
          `${colName(i)}${r}`,
          typeof c.key === "function" ? c.key(row) : row[c.key],
          c.type === "typed" ? row.type : c.type, // "typed": each row names its own format
        ))
        .join("")}</row>`,
    );
  }
  const lastCol = colName(Math.max(0, cols.length - 1));
  const widths = cols
    .map((c, i) => {
      const w = c.width || Math.min(60, Math.max(10, String(c.header).length + 2));
      const style = c.type === "text" ? ` style="${S.textfmt}"` : "";
      return `<col min="${i + 1}" max="${i + 1}" width="${w}"${style} customWidth="1"/>`;
    })
    .join("");
  const freeze = sheet.freeze === false
    ? ""
    : `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`;
  const auto = sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${r}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"${sheet.index === 0 ? ' tabSelected="1"' : ""}>${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths}</cols>
<sheetData>${pre.join("")}${rowsXml.join("")}</sheetData>
${auto}
</worksheet>`;
}

function safeSheetName(name, used) {
  const base = String(name || "Sheet").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let n = base;
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

function buildXlsx(sheets, { title = "Export", creator = "IT Ticketing" } = {}) {
  const used = new Set();
  const named = sheets.map((s, index) => ({ ...s, index, safeName: safeSheetName(s.name, used) }));
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${named.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title><dc:creator>${esc(creator)}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created>
</cp:coreProperties>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${named.map((s, i) => `<sheet name="${esc(s.safeName)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
${named.some((s) => s.rows.length) ? `<definedNames>${named
        .map((s, i) => {
          if (!s.rows.length) return "";
          const headerRow = s.title ? (s.subtitle ? 4 : 3) : 1;
          const last = colName(Math.max(0, s.columns.length - 1));
          return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.safeName.replace(/'/g, "''"))}'!$A$${headerRow}:$${last}$${headerRow + s.rows.length}</definedName>`;
        })
        .join("")}</definedNames>` : ""}
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${named.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zip(files);
}

module.exports = { buildXlsx, crc32, colName, toSerial };
