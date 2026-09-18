/* ==========================================================================
   Config — uploads
   Owns the upload directories, the multer instances, allowed MIME signatures
   and size limits. Paths are anchored to PROJECT_ROOT so they resolve to
   <root>/uploads regardless of this file's location.
   ========================================================================== */
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { PROJECT_ROOT } = require("./env");

// UPLOADS_DIR can point at a larger/backed-up volume (e.g. a NAS share).
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(PROJECT_ROOT, "uploads");
const TEMP_DIR = path.join(UPLOADS_DIR, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Allowed MIME types → expected magic-byte signatures.
const ALLOWED_MIMES = {
  "image/jpeg": ["ffd8ff"],
  "image/jpg": ["ffd8ff"],
  "image/png": ["89504e47"],
  "image/gif": ["47494638"],
  "image/webp": ["52494646", "57454250"],
  "video/mp4": ["66747970"],
  "video/webm": ["1a45dfa3"],
  "video/quicktime": ["6d6f6f76", "66747970"],
};
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_CHUNK_SIZE = 8 * 1024 * 1024; // client sends 2 MB chunks

// Multer never keeps more than one file per request, and never accepts a body
// larger than the biggest file we allow — anything bigger is cut off by multer
// before it reaches the disk-filling stage.
const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_VIDEO_SIZE, files: 1, fields: 20, fieldSize: 1024 },
});
const chunkUpload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_CHUNK_SIZE, files: 1, fields: 20, fieldSize: 1024 },
});

// Upload ids that reach the filesystem must be plain tokens — never a path.
const SAFE_ID_RE = /^[A-Za-z0-9-]{6,64}$/;

module.exports = {
  UPLOADS_DIR,
  TEMP_DIR,
  upload,
  chunkUpload,
  ALLOWED_MIMES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  SAFE_ID_RE,
};
