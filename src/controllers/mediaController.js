const path = require("path");

function makeAbsoluteUploadUrl(relativePath) {
  const uploadsBase = process.env.UPLOADS_BASE_URL || process.env.APP_BASE_URL || "";
  if (!uploadsBase) return null;
  const cleanBase = String(uploadsBase).replace(/\/$/, "");
  return `${cleanBase}${relativePath.startsWith("/") ? relativePath : `/${relativePath}`}`;
}

exports.uploadMedia = async (req, res) => {
  if (!req.file?.path) return res.status(400).json({ message: "الملف مطلوب" });
  const abs = req.file.path.replace(/\\/g, "/");
  const filename = path.basename(abs);
  const url = `/uploads/${filename}`;
  const absolute_url = makeAbsoluteUploadUrl(url) || undefined;
  res.json({ ok: true, path: abs, url, absolute_url, filename });
};
