const pool = require("../db");
const bcrypt = require("bcryptjs");

function isValidRole(role) {
  return ["DIRECTOR", "ADMIN", "TEACHER", "ABSENCE_OFFICER", "TIMETABLE_OFFICER"].includes(role);
}

exports.list = async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, avatar_url, full_name, email, role, is_active, created_at, updated_at
     FROM users
     ORDER BY id DESC
     LIMIT 500`
  );
  res.json(rows);
};

exports.create = async (req, res) => {
  try {
    const { full_name, email, password, role, avatar_url } = req.body || {};
    if (!full_name || !email || !password || !role) {
      return res.status(400).json({ message: "الاسم والبريد وكلمة المرور والدور مطلوبة" });
    }
    if (!isValidRole(role)) return res.status(400).json({ message: "الدور غير صالح" });

    const password_hash = await bcrypt.hash(String(password), 10);

    const [r] = await pool.execute(
      `INSERT INTO users (avatar_url, full_name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [avatar_url ? String(avatar_url).trim() : null, full_name.trim(), email.trim().toLowerCase(), password_hash, role]
    );

    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("Duplicate") || msg.includes("uq_users_email")) {
      return res.status(409).json({ message: "البريد الإلكتروني مستعمل من قبل" });
    }
    res.status(500).json({ message: "فشل إنشاء المستخدم", error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { full_name, email, role, is_active, avatar_url } = req.body || {};
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });
    if (role && !isValidRole(role)) return res.status(400).json({ message: "الدور غير صالح" });

    if (req.user.id === id && is_active === false) {
      return res.status(400).json({ message: "لا يمكنك تعطيل حسابك" });
    }

    await pool.execute(
      `UPDATE users SET avatar_url=?, full_name=?, email=?, role=?, is_active=? WHERE id=?`,
      [avatar_url ? String(avatar_url).trim() : null, (full_name || "").trim(), (email || "").trim().toLowerCase(), role, is_active ? 1 : 0, id]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "فشل تحديث المستخدم", error: e.message });
  }
};

exports.setPassword = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { password } = req.body || {};
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });
    if (!password || String(password).length < 6) return res.status(400).json({ message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });

    const password_hash = await bcrypt.hash(String(password), 10);
    await pool.execute(`UPDATE users SET password_hash=? WHERE id=?`, [password_hash, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "فشل تعيين كلمة المرور", error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });
    if (req.user.id === id) return res.status(400).json({ message: "لا يمكنك حذف حسابك" });

    await pool.execute(`DELETE FROM users WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "فشل حذف المستخدم", error: e.message });
  }
};
