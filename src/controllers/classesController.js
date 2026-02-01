const pool = require("../db");
const { normStr } = require("../utils/helpers");

exports.getOne = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

  const [[row]] = await pool.execute(
    "SELECT id, level, classe, cycle, is_active, `order` FROM classes WHERE id = ?",
    [id]
  );

  if (!row) return res.status(404).json({ message: "القسم غير موجود" });

  res.json(row);
};

exports.list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;

  const q = (req.query.q || "").trim();

  const where = ["1=1"];
  const params = [];

  if (q) {
    where.push("(level LIKE ? OR classe LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [[countRow]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM classes ${whereSql}`,
    params
  );
  const total = Number(countRow.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const sql = 'SELECT id, level, classe, cycle, is_active, `order` FROM classes ' + whereSql + ' ORDER BY `order` ASC, id DESC LIMIT ? OFFSET ?';
  const [rows] = await pool.execute(sql, [...params, limit, offset]);

  res.json({
    data: rows,
    meta: { page, limit, total, totalPages },
  });
};

exports.create = async (req, res) => {
  try {
    const { level, classe, cycle, is_active, order } = req.body;
    const normLevel = normStr(level);
    const normClasse = normStr(classe);

    if (!normLevel || !normClasse) {
      return res.status(400).json({ message: "المستوى والقسم مطلوبان" });
    }

    const [r] = await pool.execute(
      'INSERT INTO classes (level, classe, cycle, is_active, `order`) VALUES (?, ?, ?, ?, ?)',
      [normLevel, normClasse, normStr(cycle), is_active ? 1 : 0, Number(order) || 0]
    );

    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    if (String(e.code) === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "القسم موجود بالفعل" });
    }
    res.status(500).json({ message: "فشل إنشاء القسم", error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

    const { level, classe, cycle, is_active, order } = req.body;
    const normLevel = normStr(level);
    const normClasse = normStr(classe);

    if (!normLevel || !normClasse) {
        return res.status(400).json({ message: "المستوى والقسم مطلوبان" });
    }

    await pool.execute(
      'UPDATE classes SET level=?, classe=?, cycle=?, is_active=?, `order`=? WHERE id=?',
      [normLevel, normClasse, normStr(cycle), is_active ? 1 : 0, Number(order) || 0, id]
    );

    res.json({ ok: true });
  } catch (e) {
    if (String(e.code) === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "القسم موجود بالفعل" });
    }
    res.status(500).json({ message: "فشل تحديث القسم", error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

    await pool.execute(`DELETE FROM classes WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "فشل حذف القسم", error: e.message });
  }
};
