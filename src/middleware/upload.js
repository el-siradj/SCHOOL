const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Determine upload directory safely:
// If UPLOAD_DIR is a URL (starts with http:// or https://) we must NOT use it as a filesystem path.
const uploadDirEnv = process.env.UPLOAD_DIR || "";
let uploadDir;
if (/^https?:\/\//i.test(String(uploadDirEnv).trim())) {
  console.warn("UPLOAD_DIR appears to be a URL; falling back to local uploads directory.");
  uploadDir = path.join(__dirname, "..", "uploads");
} else if (uploadDirEnv) {
  // Use provided path; resolve relative paths against project root
  uploadDir = path.resolve(String(uploadDirEnv));
} else {
  uploadDir = path.join(__dirname, "..", "uploads");
}

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}${ext || ""}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

module.exports = upload;
