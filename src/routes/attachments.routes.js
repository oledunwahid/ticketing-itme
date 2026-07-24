/* ==========================================================================
   Routes — Attachments (/api/attachments*)
   Verbatim move from app.js (preserved robust upload logic + comment/phase
   support). URLs, middleware, validation, access control, error messages and
   response shapes unchanged. Mounted at "/" so full paths are preserved.
     POST   /api/attachments/upload         (single file)
     POST   /api/attachments/upload-chunk   (chunked upload assembly)
     DELETE /api/attachments/:id            (uploader/admin scoped)
     GET    /api/attachments/:id            (ticket-scoped or uploader/admin)
   Also starts the hourly orphaned-temp-file cleanup, as before.
   ========================================================================== */
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../../database");
const { requireAuth } = require("../middleware/auth");
const { isAdmin } = require("../utils/permissions");
const { getVisibleTicket } = require("../services/tickets.service");
const {
  UPLOADS_DIR,
  TEMP_DIR,
  upload,
  ALLOWED_MIMES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
} = require("../config/uploads");
const { validateFile } = require("../services/upload.service");

const router = express.Router();

router.post(
  "/api/attachments/upload",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const { path: tempPath, originalname, mimetype, size } = req.file;
    const err = validateFile(tempPath, mimetype, size);
    if (err) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return res.status(400).json({ error: err });
    }
    const sanitizedName = originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileId = crypto.randomUUID();
    const destPath = path.join(UPLOADS_DIR, fileId);
    try {
      fs.renameSync(tempPath, destPath);
    } catch (e) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return res.status(500).json({ error: "Failed to save file." });
    }
    const fileUrl = `/api/attachments/${fileId}`;
    try {
      await db.pRun(
        "INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, ?)",
        [fileId, fileUrl, sanitizedName, size, mimetype, req.user.id],
      );
      res
        .status(201)
        .json({
          id: fileId,
          file_url: fileUrl,
          file_name: sanitizedName,
          file_size: size,
          mime_type: mimetype,
        });
    } catch (e) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      res.status(500).json({ error: e.message });
    }
  },
);

router.post(
  "/api/attachments/upload-chunk",
  requireAuth,
  upload.single("chunk"),
  async (req, res) => {
    const { fileId, chunkIndex, totalChunks, fileName, mimeType, fileSize } =
      req.body;
    if (!req.file)
      return res.status(400).json({ error: "No file chunk received." });
    const idx = parseInt(chunkIndex, 10),
      total = parseInt(totalChunks, 10),
      size = parseInt(fileSize, 10);
    if (
      !fileId ||
      isNaN(idx) ||
      isNaN(total) ||
      !fileName ||
      !mimeType ||
      isNaN(size)
    ) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Missing chunk metadata." });
    }
    if (!ALLOWED_MIMES[mimeType]) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Unsupported file format." });
    }
    const isVideo = mimeType.startsWith("video/");
    if (size > (isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE)) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res
        .status(400)
        .json({ error: "File exceeds maximum size limits." });
    }
    const tempFilePath = path.join(TEMP_DIR, `part_${fileId}`);
    try {
      const chunkData = fs.readFileSync(req.file.path);
      fs.appendFileSync(tempFilePath, chunkData);
      fs.unlinkSync(req.file.path);
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: "Failed to process chunk." });
    }
    if (idx === total - 1) {
      const err = validateFile(tempFilePath, mimeType, size);
      if (err) {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        return res.status(400).json({ error: err });
      }
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const finalPath = path.join(UPLOADS_DIR, fileId);
      try {
        fs.renameSync(tempFilePath, finalPath);
      } catch (e) {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        return res.status(500).json({ error: "Failed to assemble upload." });
      }
      const fileUrl = `/api/attachments/${fileId}`;
      try {
        await db.pRun(
          "INSERT INTO attachments (id, ticket_id, file_url, file_name, file_size, mime_type, uploaded_by) VALUES (?, NULL, ?, ?, ?, ?, ?)",
          [fileId, fileUrl, sanitizedName, size, mimeType, req.user.id],
        );
        res
          .status(201)
          .json({
            id: fileId,
            file_url: fileUrl,
            file_name: sanitizedName,
            file_size: size,
            mime_type: mimeType,
          });
      } catch (e) {
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        res.status(500).json({ error: e.message });
      }
    } else {
      res.json({ status: "chunk_uploaded", chunkIndex: idx });
    }
  },
);

router.delete("/api/attachments/:id", requireAuth, async (req, res) => {
  const row = await db.pGet("SELECT * FROM attachments WHERE id = ?", [
    req.params.id,
  ]);
  if (!row) return res.status(404).json({ error: "Attachment not found." });
  if (req.user.role === "Requestor" && row.uploaded_by !== req.user.id)
    return res.status(403).json({ error: "Forbidden." });
  await db.pRun("DELETE FROM attachments WHERE id = ?", [req.params.id]);
  const filePath = path.join(UPLOADS_DIR, req.params.id);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error(e);
    }
  }
  res.json({ success: true });
});

router.get("/api/attachments/:id", requireAuth, async (req, res) => {
  const row = await db.pGet("SELECT * FROM attachments WHERE id = ?", [
    req.params.id,
  ]);
  if (!row)
    return res.status(404).json({ error: "Attachment reference not found." });
  const sendFileResponse = () => {
    const filePath = path.join(UPLOADS_DIR, req.params.id);
    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: "File not found on server disk." });
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    );
    res.sendFile(filePath);
  };
  // Admins/SuperAdmin: department-scoped access via the ticket.
  if (row.ticket_id) {
    const ticket = await getVisibleTicket(req.user, row.ticket_id);
    if (!ticket) return res.status(403).json({ error: "Forbidden." });
    return sendFileResponse();
  }
  // Unlinked upload — only the uploader may fetch it.
  if (row.uploaded_by !== req.user.id && !isAdmin(req.user))
    return res.status(403).json({ error: "Forbidden." });
  sendFileResponse();
});

// --- Orphaned temp upload cleanup (hourly) ---------------------------------
function cleanupOrphans() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TEMP_DIR)) {
      const p = path.join(TEMP_DIR, f);
      try {
        if (now - fs.statSync(p).mtimeMs > 6 * 60 * 60 * 1000) fs.unlinkSync(p);
      } catch (_) {}
    }
  } catch (_) {}
}
setInterval(cleanupOrphans, 60 * 60 * 1000);

module.exports = router;
