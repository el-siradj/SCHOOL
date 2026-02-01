const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "src", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `excel_${Date.now()}_${Math.random().toString(16).slice(2)}${ext || ".xlsx"}`);
  },
});

const excelUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname || "");
    cb(ok ? null : new Error("Only Excel files (.xlsx/.xls) allowed"), ok);
  },
});

module.exports = excelUpload;
