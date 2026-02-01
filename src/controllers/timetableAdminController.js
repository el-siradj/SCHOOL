const pool = require("../db");

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// ------------------------
// Subjects CRUD
// ------------------------

exports.listSubjects = async (_req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, name_ar, code, is_global, is_active FROM subjects ORDER BY name_ar ASC, id ASC"
  );
  res.json({ data: rows });
};

exports.createSubject = async (req, res) => {
  const name_ar = String(req.body?.name_ar || "").trim();
  const code = String(req.body?.code || "").trim();
  const is_global = toInt(req.body?.is_global, 0) ? 1 : 0;
  const is_active = req.body?.is_active === 0 || req.body?.is_active === false ? 0 : 1;
  if (!name_ar) return res.status(400).json({ message: "اسم المادة إجباري" });

  try {
    await pool.execute(
      "INSERT INTO subjects (name_ar, code, is_global, is_active) VALUES (?, ?, ?, ?)",
      [name_ar, code || null, is_global, is_active]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "رمز المادة موجود مسبقاً (code)" });
    }
    throw err;
  }
};

exports.updateSubject = async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ message: "معرف غير صالح" });

  const name_ar = String(req.body?.name_ar || "").trim();
  const code = String(req.body?.code || "").trim();
  const is_global = toInt(req.body?.is_global, 0) ? 1 : 0;
  const is_active = req.body?.is_active === 0 || req.body?.is_active === false ? 0 : 1;
  if (!name_ar) return res.status(400).json({ message: "اسم المادة إجباري" });

  let result;
  try {
    [result] = await pool.execute(
      "UPDATE subjects SET name_ar=?, code=?, is_global=?, is_active=? WHERE id=?",
      [name_ar, code || null, is_global, is_active, id]
    );
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "رمز المادة موجود مسبقاً (code)" });
    }
    throw err;
  }
  if (result.affectedRows === 0) return res.status(404).json({ message: "غير موجود" });
  res.json({ ok: true });
};

exports.deleteSubject = async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ message: "معرف غير صالح" });
  const [result] = await pool.execute("DELETE FROM subjects WHERE id=?", [id]);
  if (result.affectedRows === 0) return res.status(404).json({ message: "غير موجود" });
  res.json({ ok: true });
};

// ------------------------
// Curriculum: Level -> subjects weekly periods
// We use level as VARCHAR (same value stored in classes.level)
// ------------------------

exports.listLevels = async (_req, res) => {
  const [rows] = await pool.execute(
    "SELECT DISTINCT level FROM classes WHERE is_active=1 AND level IS NOT NULL AND level<>'' ORDER BY level ASC"
  );
  res.json({ data: rows.map((r) => r.level) });
};

exports.getLevelSubjects = async (req, res) => {
  const level = String(req.query.level || "").trim();
  if (!level) return res.status(400).json({ message: "المستوى إجباري" });

  const [subjects] = await pool.execute(
    "SELECT id, name_ar, code, is_global, is_active FROM subjects WHERE is_active=1 ORDER BY name_ar ASC"
  );

  const [rows] = await pool.execute(
    "SELECT id, level, subject_id, weekly_periods, is_active FROM level_subjects WHERE level=?",
    [level]
  );
  const map = new Map(rows.map((r) => [r.subject_id, r]));
  const out = subjects.map((s) => {
    const m = map.get(s.id);
    return {
      subject_id: s.id,
      name_ar: s.name_ar,
      code: s.code,
      is_global: s.is_global,
      weekly_periods: m ? Number(m.weekly_periods || 0) : 0,
      is_active: m ? Boolean(m.is_active) : false,
    };
  });
  res.json({ data: out });
};

exports.saveLevelSubjects = async (req, res) => {
  const level = String(req.body?.level || "").trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!level) return res.status(400).json({ message: "المستوى إجباري" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const it of items) {
      const subject_id = toInt(it?.subject_id);
      const weekly_periods = Math.max(0, toInt(it?.weekly_periods, 0) || 0);
      const is_active = it?.is_active ? 1 : 0;
      if (!subject_id) continue;

      await conn.execute(
        "INSERT INTO level_subjects (level, subject_id, weekly_periods, is_active) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE weekly_periods=VALUES(weekly_periods), is_active=VALUES(is_active)",
        [level, subject_id, weekly_periods, is_active]
      );
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ------------------------
// Teacher assignments
// ------------------------

exports.getTeacherSubjects = async (req, res) => {
  const teacherId = toInt(req.params.id);
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });
  const [rows] = await pool.execute("SELECT subject_id FROM teacher_subjects WHERE teacher_id=?", [teacherId]);
  res.json({ data: rows.map((r) => r.subject_id) });
};

exports.saveTeacherSubjects = async (req, res) => {
  const teacherId = toInt(req.params.id);
  const subjectIds = Array.isArray(req.body?.subject_ids) ? req.body.subject_ids.map(id => toInt(id)).filter(Boolean) : [];
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });

  console.log(`saveTeacherSubjects: teacherId=${teacherId} subjectIds=${JSON.stringify(subjectIds)}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM teacher_subjects WHERE teacher_id=?", [teacherId]);

    if (subjectIds.length > 0) {
      const placeholders = subjectIds.map(() => "(?, ?)").join(", ");
      const values = subjectIds.reduce((acc, sid) => {
        acc.push(teacherId, sid);
        return acc;
      }, []);
      await conn.execute(`INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ${placeholders}`, values);
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

exports.getTeacherClasses = async (req, res) => {
  const teacherId = toInt(req.params.id);
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });
  const [rows] = await pool.execute("SELECT class_id FROM teacher_classes WHERE teacher_id=?", [teacherId]);
  res.json({ data: rows.map((r) => r.class_id) });
};

exports.saveTeacherClasses = async (req, res) => {
  const teacherId = toInt(req.params.id);
  const classIds = Array.isArray(req.body?.class_ids) ? req.body.class_ids.map(id => toInt(id)).filter(Boolean) : [];
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });

  console.log(`saveTeacherClasses: teacherId=${teacherId} classIds=${JSON.stringify(classIds)}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM teacher_classes WHERE teacher_id=?", [teacherId]);
    
    if (classIds.length > 0) {
      const placeholders = classIds.map(() => "(?, ?)").join(", ");
      const values = classIds.reduce((acc, cid) => {
        acc.push(teacherId, cid);
        return acc;
      }, []);
      await conn.execute(`INSERT INTO teacher_classes (teacher_id, class_id) VALUES ${placeholders}`, values);
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ------------------------
// Teacher availability matrix
// ------------------------

exports.getTeacherAvailability = async (req, res) => {
  const teacherId = toInt(req.params.id);
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });

  const [days] = await pool.execute(
    "SELECT id, label_ar, `order` AS day_order, is_active FROM timetable_days WHERE is_active=1 ORDER BY `order` ASC"
  );
  const [periods] = await pool.execute(
    "SELECT id, code, `order` AS period_number, start_time, end_time, is_active FROM timetable_periods WHERE is_active=1 ORDER BY `order` ASC"
  );
  const [rows] = await pool.execute(
    "SELECT day_id, period_id, is_available FROM teacher_availability WHERE teacher_id=?",
    [teacherId]
  );
  const map = {};
  for (const r of rows) {
    map[`${r.day_id}|${r.period_id}`] = Boolean(r.is_available);
  }
  res.json({ days, periods, data: map });
};

exports.saveTeacherAvailability = async (req, res) => {
  const teacherId = toInt(req.params.id);
  const cells = req.body?.cells && typeof req.body.cells === "object" ? req.body.cells : {};
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM teacher_availability WHERE teacher_id=?", [teacherId]);
    const entries = Object.entries(cells);
    for (const [key, val] of entries) {
      const [dayId, periodId] = key.split("|");
      const day_id = toInt(dayId);
      const period_id = toInt(periodId);
      if (!day_id || !period_id) continue;
      const is_available = val ? 1 : 0;
      await conn.execute(
        "INSERT INTO teacher_availability (teacher_id, day_id, period_id, is_available) VALUES (?, ?, ?, ?)",
        [teacherId, day_id, period_id, is_available]
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ------------------------
// Teacher assigned slots (from timetable)
// Get all periods where this teacher has already been assigned
// ------------------------

exports.getTeacherAssignedSlots = async (req, res) => {
  const teacherId = toInt(req.params.id);
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });

  const [rows] = await pool.execute(
    "SELECT DISTINCT day_id, period_id FROM timetables WHERE teacher_id = ?",
    [teacherId]
  );
  
  res.json({ data: rows });
};

// ------------------------
// Timetable View & Print
// ------------------------

exports.getClassTimetableView = async (req, res) => {
  const classId = toInt(req.params.classId);
  if (!classId) return res.status(400).json({ message: "معرف القسم غير صالح" });

  const [days] = await pool.execute(
    "SELECT id, label_ar, `order` FROM timetable_days WHERE is_active=1 ORDER BY `order` ASC"
  );
  const [periods] = await pool.execute(
    "SELECT id, code, start_time, end_time, `order` FROM timetable_periods WHERE is_active=1 ORDER BY `order` ASC"
  );
  
  const [timetable] = await pool.execute(
    `SELECT t.day_id, t.period_id, s.name_ar as subject_name, 
            te.full_name as teacher_name
     FROM timetables t
     LEFT JOIN subjects s ON t.subject_id = s.id
     LEFT JOIN teachers te ON t.teacher_id = te.id
     WHERE t.class_id = ?`,
    [classId]
  );

  res.json({ days, periods, timetable });
};

exports.getTeacherTimetableView = async (req, res) => {
  const teacherId = toInt(req.params.teacherId);
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });

  const [days] = await pool.execute(
    "SELECT id, label_ar, `order` FROM timetable_days WHERE is_active=1 ORDER BY `order` ASC"
  );
  const [periods] = await pool.execute(
    "SELECT id, code, start_time, end_time, `order` FROM timetable_periods WHERE is_active=1 ORDER BY `order` ASC"
  );
  
  const [timetable] = await pool.execute(
    `SELECT t.day_id, t.period_id, s.name_ar as subject_name,
            CONCAT(c.level, ' - ', c.classe) as class_name
     FROM timetables t
     LEFT JOIN subjects s ON t.subject_id = s.id
     LEFT JOIN classes c ON t.class_id = c.id
     WHERE t.teacher_id = ?`,
    [teacherId]
  );

  res.json({ days, periods, timetable });
};

exports.generateClassTimetablePDF = async (req, res) => {
  const classId = toInt(req.params.classId);
  if (!classId) return res.status(400).json({ message: "معرف القسم غير صالح" });

  let browser;
  try {
    const puppeteer = require("puppeteer");
    
    const [classInfo] = await pool.execute("SELECT level, classe FROM classes WHERE id=?", [classId]);
    if (!classInfo.length) return res.status(404).json({ message: "القسم غير موجود" });

    const [days] = await pool.execute(
      "SELECT id, label_ar, code, `order` FROM timetable_days WHERE is_active=1 ORDER BY `order` ASC"
    );
    const [periods] = await pool.execute(
      "SELECT id, code, start_time, end_time, `order` FROM timetable_periods WHERE is_active=1 ORDER BY `order` ASC"
    );
    
    const [timetable] = await pool.execute(
      `SELECT t.day_id, t.period_id, s.name_ar as subject_name,
              te.full_name as teacher_name
       FROM timetables t
       LEFT JOIN subjects s ON t.subject_id = s.id
       LEFT JOIN teachers te ON t.teacher_id = te.id
       WHERE t.class_id = ?`,
      [classId]
    );

    const className = `${classInfo[0].level} - ${classInfo[0].classe}`;
    
    const html = generateTimetableHTML(days, periods, timetable, className, "class");

    browser = await puppeteer.launch({ 
      headless: true, 
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] 
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length);
    res.end(pdf, "binary");
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error("خطأ في توليد PDF:", error);
    res.status(500).json({ message: "فشل في توليد PDF", error: error.message });
  }
};

exports.generateTeacherTimetablePDF = async (req, res) => {
  const teacherId = toInt(req.params.teacherId);
  if (!teacherId) return res.status(400).json({ message: "معرف الأستاذ غير صالح" });

  let browser;
  try {
    const puppeteer = require("puppeteer");
    
    const [teacherInfo] = await pool.execute(
      "SELECT full_name FROM teachers WHERE id=?",
      [teacherId]
    );
    if (!teacherInfo.length) return res.status(404).json({ message: "الأستاذ غير موجود" });

    const [days] = await pool.execute(
      "SELECT id, label_ar, code, `order` FROM timetable_days WHERE is_active=1 ORDER BY `order` ASC"
    );
    const [periods] = await pool.execute(
      "SELECT id, code, start_time, end_time, `order` FROM timetable_periods WHERE is_active=1 ORDER BY `order` ASC"
    );
    
    const [timetable] = await pool.execute(
      `SELECT t.day_id, t.period_id, s.name_ar as subject_name,
              CONCAT(c.level, ' - ', c.classe) as class_name
       FROM timetables t
       LEFT JOIN subjects s ON t.subject_id = s.id
       LEFT JOIN classes c ON t.class_id = c.id
       WHERE t.teacher_id = ?`,
      [teacherId]
    );

    const teacherName = teacherInfo[0].full_name;
    
    const html = generateTimetableHTML(days, periods, timetable, teacherName, "teacher");

    browser = await puppeteer.launch({ 
      headless: true, 
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] 
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length);
    res.end(pdf, "binary");
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error("خطأ في توليد PDF:", error);
    res.status(500).json({ message: "فشل في توليد PDF", error: error.message });
  }
};

function generateTimetableHTML(days, periods, timetable, title, type) {
  const getCellContent = (dayId, periodId) => {
    return timetable.find(t => t.day_id === dayId && t.period_id === periodId);
  };

  const safeText = (text) => {
    if (text === null || text === undefined || text === 'null' || text === 'undefined') return '';
    return String(text).trim();
  };

  let tableRows = "";
  days.forEach(day => {
    let row = `<tr><td class="day-cell">${safeText(day.label_ar) || safeText(day.code)}</td>`;
    periods.forEach(period => {
      const cell = getCellContent(day.id, period.id);
      if (cell) {
        const secondary = type === "class" ? safeText(cell.teacher_name) : safeText(cell.class_name);
        const subject = safeText(cell.subject_name);
        row += `<td class="period-cell">
          <div class="subject">${subject || '—'}</div>
          ${secondary ? `<div class="secondary">${secondary}</div>` : ''}
        </td>`;
      } else {
        row += `<td class="period-cell empty">—</td>`;
      }
    });
    row += "</tr>";
    tableRows += row;
  });

  let headerCells = "";
  periods.forEach(period => {
    const startTime = safeText(period.start_time);
    const endTime = safeText(period.end_time);
    const timeRange = (startTime && endTime) ? `${startTime} - ${endTime}` : '';
    headerCells += `<th class="period-header">
      <div class="period-code">${safeText(period.code)}</div>
      ${timeRange ? `<div class="period-time">${timeRange}</div>` : ''}
    </th>`;
  });

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f8f9fa;
      padding: 20px;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 20px;
    }
    .header h1 {
      color: #1e40af;
      font-size: 28px;
      margin-bottom: 10px;
    }
    .header h2 {
      color: #64748b;
      font-size: 20px;
      font-weight: normal;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    th, td {
      border: 2px solid #cbd5e1;
      padding: 12px;
      text-align: center;
    }
    th {
      background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
      color: white;
      font-weight: bold;
    }
    .period-header {
      min-width: 120px;
    }
    .period-code {
      font-size: 16px;
      margin-bottom: 4px;
    }
    .period-time {
      font-size: 11px;
      opacity: 0.9;
    }
    .day-cell {
      background: #f1f5f9;
      font-weight: bold;
      color: #1e293b;
      min-width: 100px;
      font-size: 15px;
    }
    .period-cell {
      background: white;
      vertical-align: middle;
    }
    .period-cell.empty {
      color: #94a3b8;
      font-size: 20px;
    }
    .subject {
      font-weight: bold;
      color: #1e40af;
      font-size: 14px;
      margin-bottom: 4px;
    }
    .secondary {
      font-size: 12px;
      color: #64748b;
    }
    tr:nth-child(even) .period-cell {
      background: #f8fafc;
    }
    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>جدول الحصص</h1>
      <h2>${title}</h2>
    </div>
    <table>
      <thead>
        <tr>
          <th>اليوم \ الحصة</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>
</body>
</html>
  `;
}

// ------------------------
// Educational Structure (البنية التربوية)
// ------------------------

exports.getEducationalStructure = async (req, res) => {
  const level = String(req.query.level || "").trim();
  const cycle = String(req.query.cycle || "").trim();

  try {
    // Build WHERE clause based on filters
    let whereClause = "is_active=1";
    const params = [];
    
    if (level) {
      whereClause += " AND level=?";
      params.push(level);
    }
    
    if (cycle) {
      whereClause += " AND cycle=?";
      params.push(cycle);
    }
    
    // Get all active classes for this level/cycle
    const [classes] = await pool.execute(
      `SELECT id, level, classe, cycle FROM classes WHERE ${whereClause} ORDER BY \`order\` ASC, classe ASC`,
      params
    );

    if (!classes.length) {
      return res.json({ data: { classes: [], subjects: [], structure: [] } });
    }

    // Get all active subjects for this level (use first class level if no level filter)
    const subjectLevel = level || (classes.length > 0 ? classes[0].level : null);
    if (!subjectLevel) {
      return res.json({ data: { classes, subjects: [], structure: [] } });
    }
    
    const [subjects] = await pool.execute(
      `SELECT s.id, s.name_ar, s.code 
       FROM subjects s
       INNER JOIN level_subjects ls ON s.id = ls.subject_id
       WHERE ls.level=? AND ls.is_active=1 AND s.is_active=1
       ORDER BY s.name_ar ASC`,
      [subjectLevel]
    );

    if (!subjects.length) {
      return res.json({ data: { classes, subjects: [], structure: [] } });
    }

    // Get teacher assignments for each class and subject
    const structure = [];

    for (const cls of classes) {
      const row = {
        class_id: cls.id,
        class_name: `${cls.level} - ${cls.classe}`,
        level: cls.level,
        classe: cls.classe,
        subjects: []
      };

      for (const subject of subjects) {
        // Find teachers assigned to this subject and class (from teacher_subjects and teacher_classes)
        const [teachers] = await pool.execute(
          `SELECT DISTINCT t.id, t.full_name,
                  (SELECT ls.weekly_periods 
                   FROM level_subjects ls 
                   WHERE ls.level = ? AND ls.subject_id = ? AND ls.is_active = 1
                   LIMIT 1) as weekly_hours
           FROM teachers t
           INNER JOIN teacher_subjects ts ON t.id = ts.teacher_id
           INNER JOIN teacher_classes tc ON t.id = tc.teacher_id
           WHERE ts.subject_id = ? AND tc.class_id = ?
           ORDER BY t.full_name ASC`,
          [cls.level, subject.id, subject.id, cls.id]
        );

        row.subjects.push({
          subject_id: subject.id,
          subject_name: subject.name_ar,
          subject_code: subject.code,
          teachers: teachers.map(t => ({
            teacher_id: t.id,
            teacher_name: t.full_name,
            hours: t.weekly_hours || 0
          }))
        });
      }

      structure.push(row);
    }

    // Get distinct cycles from classes
    const cycles = [...new Set(classes.map(c => c.cycle).filter(Boolean))];

    res.json({ data: { classes, subjects, structure, cycles } });
  } catch (error) {
    console.error("Error fetching educational structure:", error);
    res.status(500).json({ message: "فشل تحميل البنية التربوية", error: error.message });
  }
};

// Get teacher assignments overview as comprehensive table
exports.getTeacherAssignments = async (req, res) => {
  try {
    const levelFilter = String(req.query.level || "").trim();
    const classFilter = toInt(req.query.class_id) || null;
    const teacherFilter = toInt(req.query.teacher_id) || null;

    // Build WHERE clause for classes
    let classWhere = "c.is_active=1";
    const classParams = [];
    
    if (levelFilter) {
      classWhere += " AND c.level=?";
      classParams.push(levelFilter);
    }
    if (classFilter) {
      classWhere += " AND c.id=?";
      classParams.push(classFilter);
    }

    // Get active classes
    const [classes] = await pool.execute(
      `SELECT c.id, c.classe, c.level, c.cycle 
       FROM classes c 
       WHERE ${classWhere}
       ORDER BY c.level ASC, c.\`order\` ASC, c.classe ASC`,
      classParams
    );

    if (!classes.length) {
      return res.json({ 
        data: { 
          classes: [], 
          subjects: [], 
          teachers: [],
          levels: [],
          assignments: [] 
        } 
      });
    }

    // Get levels for filter
    const levels = [...new Set(classes.map(c => c.level))].sort();

    // Get active subjects for these levels
    const levelsList = levels.join("','");
    const [subjects] = await pool.execute(
      `SELECT DISTINCT s.id, s.name_ar, s.code
       FROM subjects s
       INNER JOIN level_subjects ls ON s.id = ls.subject_id
       WHERE ls.level IN ('${levelsList}') AND ls.is_active=1 AND s.is_active=1
       ORDER BY s.name_ar ASC`
    );

    // Get all teachers (filtered if needed)
    let teacherWhere = "1=1";
    const teacherParams = [];
    if (teacherFilter) {
      teacherWhere = "id=?";
      teacherParams.push(teacherFilter);
    }

    const [teachers] = await pool.execute(
      `SELECT id, full_name FROM teachers WHERE ${teacherWhere} ORDER BY full_name ASC`,
      teacherParams
    );

    // Get all assignments with weekly hours from level_subjects AND actual scheduled hours from timetables
    const [assignmentsRaw] = await pool.execute(
      `SELECT 
        ts.teacher_id,
        t.full_name as teacher_name,
        ts.subject_id,
        s.name_ar as subject_name,
        tc.class_id,
        c.classe as class_name,
        c.level,
        ls.weekly_periods as required_hours,
        COUNT(DISTINCT CONCAT(tt.day_id, '-', tt.period_id)) as actual_hours
       FROM teacher_subjects ts
       INNER JOIN teachers t ON ts.teacher_id = t.id
       INNER JOIN subjects s ON ts.subject_id = s.id
       INNER JOIN teacher_classes tc ON ts.teacher_id = tc.teacher_id
       INNER JOIN classes c ON tc.class_id = c.id
       LEFT JOIN level_subjects ls ON ls.subject_id = s.id AND ls.level = c.level AND ls.is_active = 1
       LEFT JOIN timetables tt ON tt.teacher_id = ts.teacher_id 
                                  AND tt.subject_id = ts.subject_id 
                                  AND tt.class_id = tc.class_id
       WHERE c.is_active = 1
       GROUP BY ts.teacher_id, t.full_name, ts.subject_id, s.name_ar, tc.class_id, c.classe, c.level, ls.weekly_periods
       ORDER BY t.full_name ASC, s.name_ar ASC, c.level ASC, c.classe ASC`
    );

    // Filter assignments based on filters
    let assignments = assignmentsRaw;
    if (levelFilter) {
      assignments = assignments.filter(a => a.level === levelFilter);
    }
    if (classFilter) {
      assignments = assignments.filter(a => a.class_id === classFilter);
    }
    if (teacherFilter) {
      assignments = assignments.filter(a => a.teacher_id === teacherFilter);
    }

    // Build matrix structure
    const matrix = [];
    for (const subject of subjects) {
      const row = {
        subject_id: subject.id,
        subject_name: subject.name_ar,
        subject_code: subject.code,
        classes: {},
        total_hours: 0
      };

      for (const cls of classes) {
        // Find assignments for this subject-class combination
        const classAssignments = assignments.filter(
          a => a.subject_id === subject.id && a.class_id === cls.id
        );

        if (classAssignments.length > 0) {
          row.classes[cls.id] = classAssignments.map(a => ({
            teacher_id: a.teacher_id,
            teacher_name: a.teacher_name,
            required_hours: a.required_hours || 0,
            actual_hours: a.actual_hours || 0
          }));
          
          // Add to total (using actual hours)
          classAssignments.forEach(a => {
            row.total_hours += (a.actual_hours || 0);
          });
        } else {
          // Get required hours for this subject-level combination even if no teacher assigned
          const [requiredHours] = await pool.execute(
            `SELECT weekly_periods FROM level_subjects 
             WHERE level = ? AND subject_id = ? AND is_active = 1`,
            [cls.level, subject.id]
          );
          
          row.classes[cls.id] = {
            empty: true,
            required_hours: requiredHours.length > 0 ? (requiredHours[0].weekly_periods || 0) : 0
          };
        }
      }

      matrix.push(row);
    }

    res.json({ 
      data: { 
        classes, 
        subjects, 
        teachers,
        levels,
        matrix 
      } 
    });
  } catch (error) {
    console.error("Error fetching teacher assignments:", error);
    res.status(500).json({ message: "فشل تحميل إسنادات الأساتذة", error: error.message });
  }
};

// Get class schedule for a specific date (returns periods with assigned teachers)
exports.getClassSchedule = async (req, res) => {
  const classId = toInt(req.params.classId);
  const date = req.query.date;

  if (!classId) {
    return res.status(400).json({ message: "معرف القسم غير صالح" });
  }

  if (!date) {
    return res.status(400).json({ message: "التاريخ مطلوب" });
  }

  try {
    // Get day_id from date
    const dayOfWeek = new Date(date).getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    console.log('Date:', date, 'Day of week:', dayOfWeek);
    
    // Map JavaScript day to database day order (assuming 1 = Monday in DB)
    // Adjust mapping based on your timetable_days setup
    const dayOrderMap = {
      1: 1, // Monday
      2: 2, // Tuesday
      3: 3, // Wednesday
      4: 4, // Thursday
      5: 5, // Friday
      6: 6, // Saturday
      0: 7  // Sunday
    };
    
    const dayOrder = dayOrderMap[dayOfWeek];
    console.log('Day order:', dayOrder);

    // Get the day_id for this day order
    const [[day]] = await pool.execute(
      "SELECT id FROM timetable_days WHERE `order` = ? AND is_active = 1",
      [dayOrder]
    );

    console.log('Day found:', day);

    if (!day) {
      return res.json({ data: [] }); // No active day found
    }

    // Get all slots for this class and day with teacher information
    const [slots] = await pool.execute(
      `SELECT 
        t.period_id,
        tp.order AS period_number,
        t.teacher_id,
        tr.full_name AS teacher_name,
        t.subject_id,
        s.name_ar AS subject_name
      FROM timetables t
      LEFT JOIN teachers tr ON tr.id = t.teacher_id
      LEFT JOIN subjects s ON s.id = t.subject_id
      LEFT JOIN timetable_periods tp ON tp.id = t.period_id
      WHERE t.class_id = ? AND t.day_id = ? AND tp.is_active = 1
      ORDER BY tp.order ASC`,
      [classId, day.id]
    );

    console.log('Slots found for class', classId, 'on day', day.id, ':', slots);
    res.json({ data: slots });
  } catch (error) {
    console.error("Error fetching class schedule:", error);
    res.status(500).json({ message: "فشل تحميل جدول القسم", error: error.message });
  }
};
