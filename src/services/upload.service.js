/* ==========================================================================
   Service — upload validation
   Verbatim move of checkMagicBytes() and validateFile() from app.js.
   Behavior unchanged: validates a file's magic bytes against its declared
   MIME type and enforces the image/video size limits.
   ========================================================================== */
const fs = require("fs");
const {
  ALLOWED_MIMES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
} = require("../config/uploads");

function checkMagicBytes(filePath, mimeType) {
  const signatures = ALLOWED_MIMES[mimeType];
  if (!signatures) return false;
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const fileHex = buffer.toString("hex").toLowerCase();
    return signatures.some((signature) => {
      if (mimeType === "image/webp")
        return (
          fileHex.startsWith("52494646") &&
          fileHex.substring(16, 24) === "57454250"
        );
      if (mimeType === "video/mp4" || mimeType === "video/quicktime")
        return (
          fileHex.substring(8, 16) === "66747970" ||
          fileHex.substring(8, 16) === "6d6f6f76"
        );
      return fileHex.startsWith(signature.toLowerCase());
    });
  } catch (err) {
    console.error("magic bytes:", err);
    return false;
  }
}

function validateFile(filePath, mimeType, size) {
  if (!ALLOWED_MIMES[mimeType]) return "Unsupported file format.";
  const isVideo = mimeType.startsWith("video/");
  if (size > (isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE))
    return `File exceeds maximum size limit of ${isVideo ? "100MB" : "10MB"}.`;
  if (!checkMagicBytes(filePath, mimeType))
    return "File validation failed: signature (magic bytes) mismatch.";
  return null;
}

module.exports = { checkMagicBytes, validateFile };
