const XLSX = require("xlsx");
const pool = require("../db");

function normStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
function normPhone(v) {
  const s = normStr(v);
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned.length ? cleaned : null;
}
function normGender(v) {
  const s = normStr(v).toLowerCase();
  if (!s) return null;
  if (["m", "male", "homme", "ذكر", "رجل"].includes(s)) return "MALE";
  if (["f", "female", "femme", "أنثى", "امرأة"].includes(s)) return "FEMALE";
  if (["m", "male", "homme", "АЬБ?А?", "Б?Б?А?"].includes(s)) return "MALE";
  if (["f", "female", "femme", "А°Б?АўБ?", "А?Б?АўБ?", "А?Б?А?"].includes(s)) return "FEMALE";
  return null;
}

async function ensureClassesFromImport(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const [[maxRow]] = await pool.execute("SELECT COALESCE(MAX(`order`), 0) AS maxOrder FROM classes");
  let nextOrder = Number(maxRow?.maxOrder || 0) + 1;
  for (const entry of entries) {
    const level = normStr(entry.level);
    const classeValue = normStr(entry.classe ?? entry.section);
    if (!level || !classeValue) continue;
    const [[existing]] = await pool.execute(
      "SELECT id FROM classes WHERE level=? AND classe=?",
      [level, classeValue]
    );
    if (existing?.id) continue;
    await pool.execute(
      "INSERT INTO classes (level, classe, cycle, is_active, `order`) VALUES (?, ?, ?, 1, ?)",
      [level, classeValue, entry.cycle || null, nextOrder]
    );
    nextOrder += 1;
  }
}


function mapCycleArabicOnly(sectionRaw) {
  const s = normStr(sectionRaw);
  if (s === "ابتدائي") return "PRIMARY";
  if (s === "إعدادي" || s === "إعدادية") return "MIDDLE";
  if (s === "ثانوي") return "HIGH";
  if (s === "А?А?А?А?А?А?Б?") return "PRIMARY";
  if (s === "А?А?А?А?А?Б?" || s === "А?А?А?А?А?Б?") return "MIDDLE";
  if (s === "А?А°Б?Б?Б?Б?") return "HIGH";
  return null;
}

function readRows(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function readRawRows(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
}

function uniqueNonEmpty(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const s = normStr(x);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// Students columns: ID, Massar, Nom, Prenom, Genre, Telephone_Pere, Telephone_mere, Telephone_autre, Classe, niveau
exports.importStudents = async (req, res) => {
  try {
    if (!req.file?.path)
      return res.status(400).json({ message: "ملف Excel غير موجود" });

    const rows = readRows(req.file.path);
    let inserted = 0,
      updated = 0,
      skipped = 0,
      markedDeleted = 0;
    const errors = [];

    const [[countRow]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM students"
    );
    const dbEmpty = Number(countRow?.total || 0) === 0;

    const excelMassar = [];
    const classCandidates = new Map();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const class_number = Number(normStr(r.ID)) || null;
      const massar_code = normStr(r.Massar);
      const full_name = normStr(`${normStr(r.Nom)} ${normStr(r.Prenom)}`) || null;
      const gender = normGender(r.Genre ?? r.genre ?? r.GENRE);

      const father_phone = normPhone(r.Telephone_Pere);
      const mother_phone = normPhone(r.Telephone_mere);
      const guardian_phone = normPhone(r.Telephone_autre);

      const class_name = normStr(r.Classe) || null;
      const level = normStr(r.niveau) || null;

      if (level && class_name) {
        const key = level + "|||" + class_name;
        if (!classCandidates.has(key)) {
          const cycle = mapCycleArabicOnly(level) || mapCycleArabicOnly(class_name);
          classCandidates.set(key, { level, classe: class_name, cycle });
        }
      }

      if (!massar_code || !full_name || !level || !class_name) {
        skipped++;
        errors.push({
          row: i + 2,
          reason: "بيانات ناقصة (Massar/الاسم/المستوى/القسم)",
        });
        continue;
      }

      excelMassar.push(massar_code);

      if (dbEmpty) {
        const sql = `
          INSERT INTO students
            (class_number, massar_code, full_name, status, gender, level, class_name, father_phone, mother_phone, guardian_phone)
          VALUES (?, ?, ?, 'STUDYING', ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            class_number=VALUES(class_number),
            full_name=VALUES(full_name),
            gender=VALUES(gender),
            level=VALUES(level),
            class_name=VALUES(class_name),
            father_phone=VALUES(father_phone),
            mother_phone=VALUES(mother_phone),
            guardian_phone=VALUES(guardian_phone)
        `;

        const [result] = await pool.execute(sql, [
          class_number,
          massar_code,
          full_name,
          gender,
          level,
          class_name,
          father_phone,
          mother_phone,
          guardian_phone,
        ]);

        if (result.affectedRows === 1) inserted++;
        else updated++;
        continue;
      }

      const [[existing]] = await pool.execute(
        "SELECT id FROM students WHERE massar_code = ?",
        [massar_code]
      );

      if (existing?.id) {
        await pool.execute(
          `UPDATE students
              SET class_number=?, full_name=?, gender=?, level=?, class_name=?, father_phone=?, mother_phone=?, guardian_phone=?
            WHERE id=?`,
          [
            class_number,
            full_name,
            gender,
            level,
            class_name,
            father_phone,
            mother_phone,
            guardian_phone,
            existing.id,
          ]
        );
        updated++;
      } else {
        await pool.execute(
          `INSERT INTO students
            (class_number, massar_code, full_name, status, gender, level, class_name, father_phone, mother_phone, guardian_phone)
           VALUES (?, ?, ?, 'ADDED', ?, ?, ?, ?, ?, ?)`,
          [
            class_number,
            massar_code,
            full_name,
            gender,
            level,
            class_name,
            father_phone,
            mother_phone,
            guardian_phone,
          ]
        );
        inserted++;
      }
    }

    await ensureClassesFromImport(Array.from(classCandidates.values()));

        if (!dbEmpty) {
      const massarList = uniqueNonEmpty(excelMassar);
      if (massarList.length) {
        const placeholders = massarList.map(() => "?").join(",");
        const [r] = await pool.execute(
          `UPDATE students
              SET status='DELETED'
            WHERE massar_code NOT IN (${placeholders})
              AND status IN ('STUDYING','INCOMING','REFERRED','ADDED')`,
          massarList
        );
        markedDeleted = Number(r?.affectedRows || 0);
      }
    }

    const [pendingRows] = await pool.execute(
      `SELECT id, class_number, massar_code, full_name, status, level, class_name
         FROM students
        WHERE status IN ('ADDED','DELETED')
        ORDER BY class_name, class_number IS NULL, class_number, full_name, id`
    );

    res.json({
      ok: true,
      totalRows: rows.length,
      inserted,
      updated,
      skipped,
      markedDeleted,
      dbEmpty,
      pending: {
        added: pendingRows.filter((x) => x.status === "ADDED"),
        deleted: pendingRows.filter((x) => x.status === "DELETED"),
      },
      errors: errors.slice(0, 200),
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: "خطأ أثناء استيراد التلاميذ",
      error: e.message,
    });
  }
};

exports.finalizeImportedStudents = async (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (!updates.length)
      return res.status(400).json({ message: "No updates provided" });

    const allowedFromAdded = new Set(["STUDYING", "INCOMING", "REFERRED"]);
    const allowedFromDeleted = new Set(["NOT_ENROLLED", "LEFT", "DROPPED"]);

    let applied = 0;
    const errors = [];

    for (const u of updates) {
      const id = Number(u?.id);
      const next = normStr(u?.status).toUpperCase();
      if (!id || !next) continue;

      const [[row]] = await pool.execute("SELECT status FROM students WHERE id=?", [
        id,
      ]);
      const cur = String(row?.status || "");
      if (!cur) continue;

      if (cur === "ADDED") {
        if (!allowedFromAdded.has(next)) {
          errors.push({ id, reason: `Invalid target status for ADDED: ${next}` });
          continue;
        }
      } else if (cur === "DELETED") {
        if (!allowedFromDeleted.has(next)) {
          errors.push({
            id,
            reason: `Invalid target status for DELETED: ${next}`,
          });
          continue;
        }
      } else {
        errors.push({ id, reason: `Not in ADDED/DELETED (current: ${cur})` });
        continue;
      }

      const [r] = await pool.execute("UPDATE students SET status=? WHERE id=?", [
        next,
        id,
      ]);
      if (Number(r?.affectedRows || 0) > 0) applied += 1;
    }

    const [pendingRows] = await pool.execute(
      `SELECT id, class_number, massar_code, full_name, status, level, class_name
         FROM students
        WHERE status IN ('ADDED','DELETED')
        ORDER BY class_name, class_number IS NULL, class_number, full_name, id`
    );

    res.json({
      ok: true,
      applied,
      errors: errors.slice(0, 200),
      pending: {
        added: pendingRows.filter((x) => x.status === "ADDED"),
        deleted: pendingRows.filter((x) => x.status === "DELETED"),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error finalizing students", error: e.message });
  }
};

// Teachers columns: ID, Nom_Prof, Code_CIN, Genre, telephone
exports.importTeachers = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    if (!req.file?.path) return res.status(400).json({ message: "ملف Excel غير موجود" });

    const rows = readRows(req.file.path);
    let inserted = 0,
      updated = 0,
      skipped = 0;
    const errors = [];

    await conn.beginTransaction();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const full_name = normStr(r.Nom_Prof) || null;
      let code_cin = normStr(r.Code_CIN) || null;
      const gender = normGender(r.Genre ?? r.genre ?? r.GENRE);
      const phone = normPhone(r.telephone);

      if (!full_name) {
        skipped++;
        errors.push({ row: i + 2, reason: "بيانات ناقصة (الاسم مطلوب)" });
        continue;
      }
      
      // If Code_CIN is not provided, use a short placeholder (max 10 chars)
      if (!code_cin) {
        // Generate a short unique ID: T + timestamp last 8 digits + row index
        const timestamp = String(Date.now()).slice(-6);
        const rowNum = String(i).padStart(2, '0');
        code_cin = `T${timestamp}${rowNum}`;
      }

      // Upsert teacher based on Code_CIN or full_name
      let teacherId;
      
      // Search by Code_CIN first if it doesn't start with 'T' (our temp prefix)
      let existingTeacher = null;
      const [[foundByCIN]] = await conn.execute("SELECT id, Code_CIN FROM teachers WHERE Code_CIN = ?", [code_cin]);
      
      if (foundByCIN) {
        existingTeacher = foundByCIN;
      } else {
        // Search by full_name
        const [[foundByName]] = await conn.execute("SELECT id, Code_CIN FROM teachers WHERE full_name = ?", [full_name]);
        existingTeacher = foundByName || null;
      }

      if (existingTeacher) {
        teacherId = existingTeacher.id;
        // Only update Code_CIN if the new one is not a temp ID (doesn't start with T followed by digits)
        const isNewCINTemp = /^T\d{8}$/.test(code_cin);
        const updateCIN = isNewCINTemp ? existingTeacher.Code_CIN : code_cin;
        await conn.execute(
          "UPDATE teachers SET full_name=?, Code_CIN=?, gender=?, phone=? WHERE id=?", 
          [full_name, updateCIN, gender, phone, teacherId]
        );
        updated++;
      } else {
        const [result] = await conn.execute(
          "INSERT INTO teachers (full_name, Code_CIN, gender, phone) VALUES (?, ?, ?, ?)",
          [full_name, code_cin, gender, phone]
        );
        teacherId = result.insertId;
        inserted++;
      }
    }

    await conn.commit();

    res.json({
      ok: true,
      totalRows: rows.length,
      inserted,
      updated,
      skipped,
      errors: errors.slice(0, 200),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({
      ok: false,
      message: "خطأ أثناء استيراد الأساتذة",
      error: e.message,
    });
  } finally {
    conn.release();
  }
};

// Students pass massar import from export_InfoEleve_*.xlsx
// First sheet: massar_code in column 2 starting row 11, pass in column 6
exports.importStudentsPassMassar = async (req, res) => {
  try {
    if (!req.file?.path) return res.status(400).json({ message: "ملف Excel غير موجود" });

    const original = String(req.file.originalname || "");
    if (!/^export_InfoEleve_/i.test(original)) {
      return res.status(400).json({ message: "اسم الملف غير صحيح: يجب أن يبدأ بـ export_InfoEleve_" });
    }

    const rows = readRawRows(req.file.path);
    const startIndex = 10; // row 11 (1-based)

    let totalRows = 0;
    let updated = 0;
    let skipped = 0;
    let notFound = 0;
    const errors = [];

    for (let i = startIndex; i < rows.length; i++) {
      const r = Array.isArray(rows[i]) ? rows[i] : [];
      const massar_code = normStr(r[1]);
      const massar_password = normStr(r[5]);

      if (!massar_code && !massar_password) continue;
      totalRows++;

      if (!massar_code || !massar_password) {
        skipped++;
        errors.push({ row: i + 1, reason: "رقم مسار أو القن السري فارغ" });
        continue;
      }

      const [rUpdate] = await pool.execute("UPDATE students SET massar_password=? WHERE massar_code=?", [
        massar_password,
        massar_code,
      ]);

      if (Number(rUpdate?.affectedRows || 0) > 0) updated++;
      else {
        notFound++;
        errors.push({ row: i + 1, reason: `رقم مسار غير موجود في القاعدة: ${massar_code}` });
      }
    }

    res.json({
      ok: true,
      totalRows,
      inserted: 0,
      updated,
      skipped,
      notFound,
      errors: errors.slice(0, 200),
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: "خطأ أثناء استيراد القن السري للتلاميذ", error: e.message });
  }
};
