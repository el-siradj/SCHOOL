const pool = require("../db");

exports.list = async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, title, body, category, is_active, created_at FROM message_templates ORDER BY id DESC"
  );
  res.json(rows);
};

exports.create = async (req, res) => {
  const { title, body, category } = req.body || {};
  if (!title || !body) return res.status(400).json({ message: "العنوان والمحتوى مطلوبان" });

  const [r] = await pool.execute(
    "INSERT INTO message_templates (title, body, category, created_by) VALUES (?, ?, ?, ?)",
    [title, body, category || "GENERAL", req.user.id]
  );
  res.json({ ok: true, id: r.insertId });
};

exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const { title, body, category, is_active } = req.body || {};
  await pool.execute(
    "UPDATE message_templates SET title=?, body=?, category=?, is_active=? WHERE id=?",
    [title, body, category || "GENERAL", is_active ? 1 : 0, id]
  );
  res.json({ ok: true });
};

exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  await pool.execute("DELETE FROM message_templates WHERE id=?", [id]);
  res.json({ ok: true });
};
