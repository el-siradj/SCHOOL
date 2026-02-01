const pool = require("../db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { logger } = require("../utils/logger");

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "البريد الإلكتروني وكلمة المرور مطلوبان" });

    const [rows] = await pool.execute(
      "SELECT id, avatar_url, full_name, email, password_hash, role, is_active FROM users WHERE email=? LIMIT 1",
      [String(email).trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      logger.security("failed-login-attempt", {
        email,
        reason: "invalid-credentials",
        ip: req.ip,
      });
      return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      logger.security("failed-login-attempt", {
        email,
        userId: user.id,
        reason: "wrong-password",
        ip: req.ip,
      });
      return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    }

    const token = signToken(user);

    logger.auth("login", user.id, {
      email: user.email,
      role: user.role,
      ip: req.ip,
    });

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Also return token to support internal deployments where frontend & backend are on different origins.
    res.json({ ok: true, token, user: { id: user.id, avatar_url: user.avatar_url || null, full_name: user.full_name, email: user.email, role: user.role } });
  } catch (e) {
    logger.error("Login error", e, { email: req.body?.email, ip: req.ip });
    res.status(500).json({ message: "فشل تسجيل الدخول", error: e.message });
  }
};

exports.me = async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, avatar_url, full_name, email, role, is_active FROM users WHERE id=? LIMIT 1",
    [req.user.id]
  );
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ message: "غير مصرح" });
  res.json({ id: user.id, avatar_url: user.avatar_url || null, full_name: user.full_name, email: user.email, role: user.role });
};

exports.updateMe = async (req, res) => {
  try {
    const full_name = String(req.body?.full_name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const avatar_url = String(req.body?.avatar_url || "").trim();
    if (!full_name || !email) return res.status(400).json({ message: "الاسم الكامل والبريد الإلكتروني مطلوبان" });

    await pool.execute(
      "UPDATE users SET avatar_url=?, full_name=?, email=? WHERE id=?",
      [avatar_url || null, full_name, email, req.user.id]
    );

    const [rows] = await pool.execute(
      "SELECT id, avatar_url, full_name, email, role, is_active FROM users WHERE id=? LIMIT 1",
      [req.user.id]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ message: "غير مصرح" });

    const token = signToken(user);
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, token, user: { id: user.id, avatar_url: user.avatar_url || null, full_name: user.full_name, email: user.email, role: user.role } });
  } catch (e) {
    const msg = String(e.message || "");
    if (String(e.code) === "ER_DUP_ENTRY" || msg.includes("Duplicate") || msg.includes("uq_users_email")) {
      return res.status(409).json({ message: "البريد الإلكتروني مستعمل من قبل" });
    }
    res.status(500).json({ message: "فشل تحديث الملف الشخصي", error: e.message });
  }
};

exports.logout = async (req, res) => {
  logger.auth("logout", req.user?.id, { ip: req.ip });
  res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: false });
  res.json({ ok: true });
};

exports.changeMyPassword = async (req, res) => {
  try {
    const current_password = String(req.body?.current_password || "");
    const new_password = String(req.body?.new_password || "");
    if (!current_password || !new_password) return res.status(400).json({ message: "كلمة المرور الحالية والجديدة مطلوبتان" });
    if (new_password.length < 6) return res.status(400).json({ message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });

    const [rows] = await pool.execute(
      "SELECT id, password_hash, is_active FROM users WHERE id=? LIMIT 1",
      [req.user.id]
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ message: "غير مصرح" });

    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) return res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" });

    const password_hash = await bcrypt.hash(new_password, 10);
    await pool.execute("UPDATE users SET password_hash=? WHERE id=?", [password_hash, req.user.id]);
    
    logger.auth("password-changed", req.user.id, { ip: req.ip });
    
    res.json({ ok: true });
  } catch (e) {
    logger.error("Password change failed", e, { userId: req.user?.id });
    res.status(500).json({ message: "فشل تغيير كلمة المرور", error: e.message });
  }
};
