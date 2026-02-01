const pool = require("../db");
const { normStr, normPhone, normGender } = require("../utils/helpers");

exports.getOne = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

  const [[row]] = await pool.execute(
    "SELECT id, full_name, Code_CIN, gender, phone, is_active FROM teachers WHERE id = ?",
    [id]
  );

  if (!row) return res.status(404).json({ message: "الأستاذ غير موجود" });

  const [subjectRows] = await pool.execute(
    "SELECT subject_id FROM teacher_subjects WHERE teacher_id = ?",
    [id]
  );
  const [classRows] = await pool.execute(
    "SELECT class_id FROM teacher_classes WHERE teacher_id = ?",
    [id]
  );

  res.json({
    ...row,
    subjects: subjectRows.map(r => r.subject_id),
    classes: classRows.map(r => r.class_id),
  });
};

exports.list = async (req, res) => {
  // Debug logging
  console.log('🔍 [Teachers List] Query params:', req.query);
  console.log('🔍 [Teachers List] req.query.all value:', req.query.all);
  console.log('🔍 [Teachers List] Condition check:', req.query.all === 'true' || req.query.all === '1');
  
  // If 'all' parameter is set, return all teachers without pagination
  if (req.query.all === 'true' || req.query.all === '1') {
    console.log('✅ [Teachers List] Using ALL mode (no pagination)');
    const [rows] = await pool.execute(
      `SELECT
          t.id, t.full_name, t.Code_CIN, t.gender, t.phone, t.is_active,
          GROUP_CONCAT(s.name_ar SEPARATOR ', ') AS subject_names
         FROM teachers t
         LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
         LEFT JOIN subjects s ON ts.subject_id = s.id
        WHERE t.is_active = 1
        GROUP BY t.id
        ORDER BY t.full_name ASC
        LIMIT 999999`
    );

    console.log(`🔍 [Teachers List] SQL returned ${rows.length} rows`);

    const data = rows.map((r) => ({
      ...r,
      subject_names: r.subject_names || "",
    }));

    console.log(`✅ Backend: إرجاع ${data.length} أستاذ مفعّل`);
    console.log(`📤 [Teachers List] Sending response with ${data.length} teachers`);
    return res.json({ data });
  }
  
  console.log('⚠️ [Teachers List] Using PAGINATED mode (limit=20)');

  // Normal paginated list
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;

  const q = (req.query.q || "").trim();
  const matiere = (req.query.matiere || "").trim();
  const gender = (req.query.gender || "").trim().toUpperCase();

  const where = ["1=1"];
  const params = [];
  const having = [];
  const havingParams = [];

  if (matiere) {
    having.push("subjects_names LIKE ?");
    havingParams.push(`%${matiere}%`);
  }
  if (q) {
    where.push("t.full_name LIKE ? OR t.Code_CIN LIKE ?");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (gender && ["MALE", "FEMALE"].includes(gender)) {
    where.push("t.gender = ?");
    params.push(gender);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const havingSql = having.length ? `HAVING ${having.join(" AND ")}` : "";

  const countSql = `
    SELECT COUNT(*) AS total
    FROM (
      SELECT t.id
      FROM teachers t
      LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
      LEFT JOIN subjects s ON ts.subject_id = s.id
      ${whereSql}
      GROUP BY t.id
      ${havingSql}
    ) AS filtered_teachers
  `;
  const [[countRow]] = await pool.execute(countSql, [...params, ...havingParams]);
  const total = Number(countRow.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const [rows] = await pool.execute(
    `SELECT
        t.id, t.full_name, t.Code_CIN, t.gender, t.phone, t.is_active,
        GROUP_CONCAT(s.name_ar SEPARATOR ', ') AS subject_names
       FROM teachers t
       LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
       LEFT JOIN subjects s ON ts.subject_id = s.id
      ${whereSql}
      GROUP BY t.id
      ${havingSql}
      ORDER BY t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, ...havingParams, limit, offset]
  );

  const data = rows.map((r) => ({
    ...r,
    subject_names: r.subject_names || "",
  }));

  res.json({
    data,
    meta: { page, limit, total, totalPages },
  });
};

exports.listActive = async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT
        t.id, t.full_name, t.Code_CIN, t.gender, t.phone, t.is_active,
        GROUP_CONCAT(s.name_ar SEPARATOR ', ') AS subject_names
       FROM teachers t
       LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
       LEFT JOIN subjects s ON ts.subject_id = s.id
      WHERE t.is_active = 1
      GROUP BY t.id
      ORDER BY t.full_name ASC`
  );

  const data = rows.map((r) => ({
    ...r,
    subject_names: r.subject_names || "",
  }));

  res.json({ data });
};

exports.create = async (req, res) => {
  try {
    const full_name = normStr(req.body?.full_name);
    const Code_CIN = normStr(req.body?.Code_CIN);
    const gender = normGender(req.body?.gender);
    const phone = normPhone(req.body?.phone);

    if (!full_name || !Code_CIN) {
      return res.status(400).json({ message: "الاسم و رقم بطاقة التعريف الوطنية مطلوبان" });
    }

    const [r] = await pool.execute(
      `INSERT INTO teachers (full_name, Code_CIN, gender, phone)
       VALUES (?, ?, ?, ?)`,
      [full_name, Code_CIN, gender, phone]
    );

    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    if (String(e.code) === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "الأستاذ موجود بالفعل" });
    }
    res.status(500).json({ message: "فشل إنشاء الأستاذ", error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

    const full_name = normStr(req.body?.full_name);
    const Code_CIN = normStr(req.body?.Code_CIN);
    const gender = normGender(req.body?.gender);
    const phone = normPhone(req.body?.phone);

    if (!full_name || !Code_CIN) {
      return res.status(400).json({ message: "الاسم و رقم بطاقة التعريف الوطنية مطلوبان" });
    }

    await pool.execute(
      `UPDATE teachers SET full_name=?, Code_CIN=?, gender=?, phone=? WHERE id=?`,
      [full_name, Code_CIN, gender, phone, id]
    );

    res.json({ ok: true });
  } catch (e) {
    if (String(e.code) === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "الأستاذ موجود بالفعل" });
    }
    res.status(500).json({ message: "فشل تحديث الأستاذ", error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

    await pool.execute(`DELETE FROM teachers WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "فشل حذف الأستاذ", error: e.message });
  }
};

