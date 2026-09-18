/* ==========================================================================
   Routes — Attachments (/api/attachments*)
     POST   /api/attachments/upload         (single file)
     POST   /api/attachments/upload-chunk   (chunked upload assembly)
     DELETE /api/attachments/:id            (uploader while unlinked · dept admin)
     GET    /api/attachments/:id            (ticket-scoped or uploader/admin)

   Hardening notes
   • The client's chunk `fileId` is only a correlation token: it is validated
     against a strict charset and namespaced by user, and the stored file always
     gets a fresh server-generated UUID. It can never become a path.
   • Chunks must arrive in order; the assembled size is measured on disk and
     must equal the declared size.
   ========================================================================== */
const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../../database");
const { requireAuth } = require("../middleware/auth");
const { isAdmin, adminScopeForTicket } = require("../utils/permissions");
const { getVisibleTicket } = require("../services/tickets.service");
const {
  UPLOADS_DIR,
  TEMP_DIR,
  upload,
  chunkUpload,
  ALLOWED_MIMES,
  SAFE_ID_RE,
} = require("../config/uploads");
const {
  storeValidated,
  safeUnlink,
  maxSizeFor,
  cleanupUploads,
} = require("../services/upload.service");

const router = express.Router();

router.post(
  "/api/attachments/upload",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const out = await storeValidated(req.file.path, {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedBy: req.user.id,
    });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.status(201).json(out.row);
  },
);

// In-flight chunked uploads: key → { next, total, mimeType, size, fileName, touched }
const chunkSessions = new Map();
const MAX_CHUNKS = 200;

router.post(
  "/api/attachments/upload-chunk",
  requireAuth,
  chunkUpload.single("chunk"),
  async (req, res) => {
    const chunkPath = req.file && req.file.path;
    const fail = (status, error) => {
      safeUnlink(chunkPath);
      return res.status(status).json({ error });
    };
    if (!req.file) return res.status(400).json({ error: "No file chunk received." });

    const { fileId, chunkIndex, totalChunks, fileName, mimeType, fileSize } = req.body || {};
    const idx = Number.parseInt(chunkIndex, 10);
    const total = Number.parseInt(totalChunks, 10);
    const size = Number.parseInt(fileSize, 10);
    if (
      !SAFE_ID_RE.test(String(fileId || "")) ||
      !Number.isInteger(idx) || !Number.isInteger(total) || !Number.isInteger(size) ||
      idx < 0 || total < 1 || total > MAX_CHUNKS || idx >= total || size < 1 ||
      !fileName || !mimeType
    )
      return fail(400, "Missing or invalid chunk metadata.");
    if (!ALLOWED_MIMES[mimeType]) return fail(400, "Unsupported file format.");
    if (size > maxSizeFor(mimeType)) return fail(400, "File exceeds maximum size limits.");

    const key = `${req.user.id}_${fileId}`;
    const partPath = path.join(TEMP_DIR, `part_${key}`);
    let session = chunkSessions.get(key);
    if (idx === 0) {
      safeUnlink(partPath); // a retry restarts from scratch
      session = { next: 0, total, mimeType, size, fileName: String(fileName), touched: Date.now() };
      chunkSessions.set(key, session);
    }
    if (!session || session.next !== idx || session.total !== total || session.mimeType !== mimeType || session.size !== size) {
      return fail(409, "Upload out of sequence. Please retry the file.");
    }

    try {
      fs.appendFileSync(partPath, fs.readFileSync(chunkPath));
      safeUnlink(chunkPath);
    } catch (e) {
      console.error("[upload] chunk append failed:", e.message);
      chunkSessions.delete(key);
      safeUnlink(partPath);
      return fail(500, "Failed to process chunk.");
    }
    const assembled = fs.statSync(partPath).size;
    if (assembled > size) {
      chunkSessions.delete(key);
      safeUnlink(partPath);
      return res.status(400).json({ error: "Upload is larger than declared." });
    }
    session.next += 1;
    session.touched = Date.now();

    if (idx < total - 1) return res.json({ status: "chunk_uploaded", chunkIndex: idx });

    chunkSessions.delete(key);
    if (assembled !== size) {
      safeUnlink(partPath);
      return res.status(400).json({ error: "Upload is incomplete. Please retry." });
    }
    const out = await storeValidated(partPath, {
      originalName: session.fileName,
      mimeType,
      uploadedBy: req.user.id,
    });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.status(201).json(out.row);
  },
);

router.delete("/api/attachments/:id", requireAuth, async (req, res) => {
  try {
    if (!SAFE_ID_RE.test(req.params.id))
      return res.status(404).json({ error: "Attachment not found." });
    const row = await db.pGet("SELECT * FROM attachments WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Attachment not found." });

    let allowed = false;
    if (!row.ticket_id) {
      // Still a draft upload: only whoever uploaded it (or an admin) may discard it.
      allowed = row.uploaded_by === req.user.id || isAdmin(req.user);
    } else {
      // Evidence already on a ticket is part of its history — dept admins only.
      const ticket = await getVisibleTicket(req.user, row.ticket_id);
      allowed = !!ticket && adminScopeForTicket(req.user, ticket);
    }
    if (!allowed) return res.status(403).json({ error: "Forbidden." });

    await db.pRun("DELETE FROM attachments WHERE id = ?", [row.id]);
    safeUnlink(path.join(UPLOADS_DIR, row.id));
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete attachment." });
  }
});

router.get("/api/attachments/:id", requireAuth, async (req, res) => {
  try {
    if (!SAFE_ID_RE.test(req.params.id))
      return res.status(404).json({ error: "Attachment reference not found." });
    const row = await db.pGet("SELECT * FROM attachments WHERE id = ?", [req.params.id]);
    if (!row)
      return res.status(404).json({ error: "Attachment reference not found." });

    if (row.ticket_id) {
      const ticket = await getVisibleTicket(req.user, row.ticket_id, { techFilter: "all" });
      if (!ticket) return res.status(403).json({ error: "Forbidden." });
    } else if (row.uploaded_by !== req.user.id && !isAdmin(req.user)) {
      // Unlinked upload — only the uploader (or an admin) may fetch it.
      return res.status(403).json({ error: "Forbidden." });
    }

    const filePath = path.join(UPLOADS_DIR, row.id);
    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: "File not found on server disk." });
    // Only allow-listed media types are ever stored, but never let the browser
    // second-guess the declared type.
    const type = ALLOWED_MIMES[row.mime_type] ? row.mime_type : "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    );
    res.sendFile(filePath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load attachment." });
  }
});

// --- Housekeeping (hourly) -------------------------------------------------
function sweepChunkSessions() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, s] of chunkSessions) {
    if (s.touched < cutoff) {
      chunkSessions.delete(key);
      safeUnlink(path.join(TEMP_DIR, `part_${key}`));
    }
  }
}
const housekeeping = setInterval(() => {
  sweepChunkSessions();
  cleanupUploads();
}, 60 * 60 * 1000);
housekeeping.unref();

module.exports = router;
