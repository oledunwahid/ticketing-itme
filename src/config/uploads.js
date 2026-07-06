/* ==========================================================================
   Config — uploads
   Owns the upload directories, the multer instance, allowed MIME signatures
   and size limits. Behavior identical to the previous inline setup in app.js;
   paths are anchored to PROJECT_ROOT so they resolve to <root>/uploads
   regardless of this file's location.
   ========================================================================== */
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { PROJECT_ROOT } = require("./env");

const UPLOADS_DIR = path.join(PROJECT_ROOT, "uploads");
const TEMP_DIR = path.join(UPLOADS_DIR, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const upload = multer({ dest: TEMP_DIR });

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

module.exports = {
  UPLOADS_DIR,
  TEMP_DIR,
  upload,
  ALLOWED_MIMES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
};
