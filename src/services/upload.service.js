/* ==========================================================================
   Service — upload validation & storage
   • validateFile()   magic bytes vs declared MIME + size limits (the size is
                      read from disk, never trusted from the client)
   • storeValidated() move a validated temp file into uploads/ under a fresh
                      server-generated id and record the attachments row
   • cleanupUploads() drop stale temp parts and never-linked uploads
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../../database");
const {
  UPLOADS_DIR,
  TEMP_DIR,
  ALLOWED_MIMES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
} = require("../config/uploads");

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.error("[upload] unlink failed:", e.message);
  }
}

function checkMagicBytes(filePath, mimeType) {
  const signatures = ALLOWED_MIMES[mimeType];
  if (!signatures) return false;
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const fileHex = buffer.toString("hex").toLowerCase();
    if (mimeType === "image/webp")
      return fileHex.startsWith("52494646") && fileHex.substring(16, 24) === "57454250";
    if (mimeType === "video/mp4" || mimeType === "video/quicktime")
      return (
        fileHex.substring(8, 16) === "66747970" ||
        fileHex.substring(8, 16) === "6d6f6f76"
      );
    return signatures.some((signature) => fileHex.startsWith(signature.toLowerCase()));
  } catch (err) {
    console.error("magic bytes:", err.message);
    return false;
  }
}

const maxSizeFor = (mimeType) =>
  String(mimeType).startsWith("video/") ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

function validateFile(filePath, mimeType) {
  if (!ALLOWED_MIMES[mimeType]) return "Unsupported file format.";
  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch (_) {
    return "Uploaded file is missing.";
  }
  if (size === 0) return "The file is empty.";
  if (size > maxSizeFor(mimeType))
    return `File exceeds maximum size limit of ${mimeType.startsWith("video/") ? "100MB" : "10MB"}.`;
  if (!checkMagicBytes(filePath, mimeType))
    return "File validation failed: the content does not match its type.";
  return null;
}

// Keep a readable, filesystem-neutral display name (the stored file is always
// named by its id, so this is never used as a path).
function sanitizeName(name) {
  const base = String(name || "file").split(/[\\/]/).pop();
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

/**
 * Validate `tempPath`, move it into uploads/ and insert the attachments row.
 * Returns { row } or { error, status }. The temp file is always consumed.
 */
async function storeValidated(tempPath, { originalName, mimeType, uploadedBy }) {
  const err = validateFile(tempPath, mimeType);
  if (err) {
    safeUnlink(tempPath);
    return { error: err, status: 400 };
  }
  const size = fs.statSync(tempPath).size;
  const fileId = crypto.randomUUID();
  const destPath = path.join(UPLOADS_DIR, fileId);
  try {
    fs.renameSync(tempPath, destPath);
  } catch (e) {
    safeUnlink(tempPath);
    console.error("[upload] move failed:", e.message);
    return { error: "Failed to save file.", status: 500 };
  }
  const row = {
    id: fileId,
    file_url: `/api/attachments/${fileId}`,
    file_name: sanitizeName(originalName),
    file_size: size,
    mime_type: mimeType,
  };
  try {
    await db.pRun(
      "INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, ?)",
      [row.id, row.file_url, row.file_name, row.file_size, row.mime_type, uploadedBy || null],
    );
  } catch (e) {
    safeUnlink(destPath);
    console.error("[upload] db insert failed:", e.message);
    return { error: "Failed to record upload.", status: 500 };
  }
  return { row };
}

/* Only accept attachment ids the caller uploaded themselves and that are not
   yet attached to anything — so nobody can move another ticket's evidence
   onto their own ticket or comment. Returns the sanitized id list. */
function normalizeIds(ids, max = 10) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x) => typeof x === "string" && /^[A-Za-z0-9-]{6,64}$/.test(x)))].slice(0, max);
}

// Stale temp parts (abandoned chunked uploads) and uploads that were never
// linked to a ticket (the form was abandoned) are removed after a grace period.
const TEMP_TTL_MS = 6 * 60 * 60 * 1000;
const UNLINKED_TTL_HOURS = 24;
async function cleanupUploads() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TEMP_DIR)) {
      const p = path.join(TEMP_DIR, f);
      try {
        if (f !== ".gitkeep" && now - fs.statSync(p).mtimeMs > TEMP_TTL_MS) fs.unlinkSync(p);
      } catch (_) {}
    }
  } catch (_) {}
  try {
    const stale = await db.pAll(
      `SELECT id FROM attachments
        WHERE ticket_id IS NULL AND comment_id IS NULL
          AND created_at < datetime('now', ?)`,
      [`-${UNLINKED_TTL_HOURS} hours`],
    );
    for (const { id } of stale) {
      await db.pRun("DELETE FROM attachments WHERE id = ?", [id]);
      if (/^[A-Za-z0-9-]{6,64}$/.test(id)) safeUnlink(path.join(UPLOADS_DIR, id));
    }
    if (stale.length) console.log(`[upload] removed ${stale.length} unlinked upload(s)`);
  } catch (e) {
    console.error("[upload] cleanup failed:", e.message);
  }
}

module.exports = {
  checkMagicBytes,
  validateFile,
  storeValidated,
  sanitizeName,
  normalizeIds,
  safeUnlink,
  maxSizeFor,
  cleanupUploads,
};
