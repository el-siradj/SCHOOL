const jwt = require("jsonwebtoken");

function parseCookies(header) {
  const out = {};
  const s = String(header || "");
  if (!s) return out;
  const parts = s.split(";").map((x) => x.trim()).filter(Boolean);
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}



function authRequired(req, res, next) {




  const h = req.headers.authorization || "";
  const tokenFromHeader = h.startsWith("Bearer ") ? h.slice(7) : null;
  const tokenFromCookie = parseCookies(req.headers.cookie || "").token || null;
  const token = tokenFromHeader || tokenFromCookie;
  if (!token) return res.status(401).json({ message: "غير مصرح" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, role, full_name }
    next();
  } catch {
    return res.status(401).json({ message: "رمز الدخول غير صالح" });
  }
}

/**
 * Role guard (case-insensitive)
 * Usage: requireRole('DIRECTOR', 'ADMIN')
 */
function requireRole(...roles) {
  const allowed = (Array.isArray(roles) ? roles : [])
    .flat()
    .filter(Boolean)
    .map((r) => String(r).toUpperCase());

  return (req, res, next) => {
    const userRole = String(req.user?.role || "").toUpperCase();
    if (!allowed.includes(userRole)) {
      return res.status(403).json({ message: "ليس لديك الصلاحية" });
    }
    next();
  };
}

/**
 * Shortcut: allow DIRECTOR plus extra roles (e.g. allowDirectorOr('ADMIN'))
 */
function allowDirectorOr(...roles) {
  return requireRole("DIRECTOR", ...roles);
}

module.exports = { authRequired, requireRole, allowDirectorOr };
