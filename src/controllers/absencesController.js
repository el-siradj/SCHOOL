const pool = require("../db");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { toDigitsMorocco, toJid, sendOne } = require("../services/whatsapp/queue");
const { logger } = require("../utils/logger");

// توليد PDF إشعار غياب عام بدون عدد الأيام أو رقم الإشعار
exports.getSimpleAbsenceNoticesPdf = async (req, res) => {
  try {
    const studentIds = Array.isArray(req.body.student_ids)
      ? req.body.student_ids.filter((id) => Number.isFinite(Number(id))).map(Number)
      : [];
    if (!studentIds.length) {
      return res.status(400).json({ message: "يجب اختيار تلاميذ." });
    }

    // جلب بيانات التلاميذ
    const [students] = await pool.execute(
      `SELECT id, full_name, class_name, class_number, massar_code FROM students WHERE id IN (${studentIds.map(() => '?').join(',')})`,
      studentIds
    );
    if (!students.length) {
      return res.status(404).json({ message: "لم يتم العثور على تلاميذ." });
    }

    // توليد HTML بسيط للإشعار العام
    const html = `
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>إشعار غياب عام</title>
        <style>
          body { font-family: 'Arial', 'Tahoma', sans-serif; margin: 40px; }
          .notice { border: 1px solid #888; border-radius: 12px; padding: 24px; margin-bottom: 40px; }
          .header { font-size: 20px; font-weight: bold; margin-bottom: 12px; }
          .row { margin-bottom: 8px; }
        </style>
      </head>
      <body>
        ${students
        .map(
          (s) => `
              <div class="notice">
                <div class="header">إشعار بالغياب</div>
                <div class="row">الاسم: <b>${s.full_name}</b></div>
                <div class="row">القسم: <b>${s.class_name || ''}</b></div>
                <div class="row">الرقم: <b>${s.class_number ?? ''}</b></div>
                <div class="row">مسار: <b>${s.massar_code}</b></div>
                <div class="row" style="margin-top:16px;">نحيطكم علما أن التلميذ/ة المذكور أعلاه قد تغيب عن الدراسة. المرجو التواصل مع الإدارة لمزيد من التفاصيل.</div>
              </div>
            `
        )
        .join('')}
      </body>
      </html>
    `;

    // توليد PDF
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 60000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline; filename=absence-simple-notices.pdf");
    res.end(pdfBuffer);
  } catch (e) {
    logger.error("PDF إشعار عام خطأ:", e);
    res.status(500).json({ message: "فشل إنشاء PDF", error: e.message });
  }
};

function normStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toHHMM(value) {
  if (!value) return "";
  const s = String(value);
  const m = s.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

function getJsDayFromYMD(dateStr) {
  const parts = String(dateStr || "").split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const jsDay = dt.getUTCDay(); // 0=Sun ... 6=Sat
  return Number.isFinite(jsDay) ? jsDay : null;
}

async function getActivePeriodsCount() {
  const [[row]] = await pool.execute("SELECT COUNT(*) AS total FROM timetable_periods WHERE Is_active=1");
  return Math.max(1, Math.min(8, Number(row?.total || 8)));
}

async function getAllowedPeriodsForDate() {
  const [[countRow]] = await pool.execute("SELECT COUNT(*) AS total FROM timetable_periods WHERE Is_active=1");
  const periodsCount = Math.max(1, Math.min(8, Number(countRow?.total || 8)));
  return new Set(Array.from({ length: periodsCount }, (_, i) => i + 1));
}

function normalizeClassKey(level, className) {
  const levelNorm = normStr(level).toLowerCase();
  const classNorm = normStr(className).toLowerCase();
  return { key: `${levelNorm}|||${classNorm}`, levelNorm, classNorm };
}

async function findCycleForClass(client, level, className, cache = new Map()) {
  const { key, levelNorm, classNorm } = normalizeClassKey(level, className);
  if (cache.has(key)) return cache.get(key);
  if (!levelNorm && !classNorm) {
    cache.set(key, null);
    return null;
  }
  const [rows] = await client.execute(
    "SELECT cycle FROM classes WHERE LOWER(level)=? AND LOWER(classe)=? AND is_active=1 LIMIT 1",
    [levelNorm, classNorm]
  );
  const cycle = rows[0]?.cycle ? String(rows[0].cycle).trim().toUpperCase() : null;
  cache.set(key, cycle);
  return cycle;
}

async function loadStudyPeriodsMap(client, dateStr) {
  const jsDay = getJsDayFromYMD(dateStr);
  if (!jsDay || jsDay === 0) return { map: new Map(), dayId: null };

  const [[dayRow]] = await client.execute(
    "SELECT id FROM timetable_days WHERE `Order`=? AND Is_active=1 LIMIT 1",
    [jsDay]
  );
  if (!dayRow?.id) return { map: new Map(), dayId: null };

  const [rows] = await client.execute(
    `SELECT tsp.cycle, tp.\`order\` AS period_number
       FROM timetable_study_periods tsp
       JOIN timetable_periods tp ON tp.id = tsp.period_id AND tp.Is_active = 1
      WHERE tsp.day_id = ? AND tsp.is_active = 1`,
    [dayRow.id]
  );

  const map = new Map();
  rows.forEach((row) => {
    const cycle = String(row.cycle || "").trim().toUpperCase();
    const periodNumber = Number(row.period_number);
    if (!cycle || !Number.isFinite(periodNumber) || periodNumber <= 0) return;
    if (!map.has(cycle)) map.set(cycle, new Set());
    map.get(cycle).add(Math.round(periodNumber));
  });

  return { map, dayId: dayRow.id };
}

function resolveAllowedSetForCycle(cycle, studyMap, fallbackSet) {
  if (cycle) {
    const normalized = String(cycle).trim().toUpperCase();
    const entry = studyMap.get(normalized);
    if (entry && entry.size) {
      return entry;
    }
  }
  return fallbackSet;
}

exports.getOne = async (req, res) => {
  if (!id) return res.status(400).json({ message: "معرف غير صالح" });

  const [[row]] = await pool.execute(
    `SELECT a.id, a.student_id, a.absence_date, a.section, a.period_number, a.absence_type, a.created_by, a.created_at, a.updated_at,
            s.full_name AS student_name, s.massar_code, s.level, s.class_name
       FROM absences a
       JOIN students s ON a.student_id = s.id
      WHERE a.id = ?`,
    [id]
  );

  if (!row) return res.status(404).json({ message: "الغائب غير موجود" });

  res.json(row);
};

exports.list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;

  const studentId = req.query.student_id ? Number(req.query.student_id) : null;
  const date = normStr(req.query.date);
  const section = normStr(req.query.section);
  const periodNumber = req.query.period_number ? Number(req.query.period_number) : null;

  const where = [];
  const params = [];

  if (studentId) {
    where.push("a.student_id = ?");
    params.push(studentId);
  }
  if (date) {
    where.push("a.absence_date = ?");
    params.push(date);
  }
  if (section) {
    where.push("a.section = ?");
    params.push(section);
  }
  if (periodNumber) {
    where.push("a.period_number = ?");
    params.push(periodNumber);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM absences a ${whereSql}`, params);

  const total = Number(countRow.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const [rows] = await pool.execute(
    `SELECT a.id, a.student_id, a.absence_date, a.section, a.period_number, a.absence_type, a.created_by, a.created_at, a.updated_at,
            s.full_name AS student_name, s.massar_code, s.level, s.class_name
       FROM absences a
       JOIN students s ON a.student_id = s.id
      ${whereSql}
      ORDER BY a.absence_date DESC, a.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({
    data: rows,
    meta: { page, limit, total, totalPages },
  });
};

exports.create = async (req, res) => {
  try {
    const student_id = Number(req.body?.student_id);
    const absence_date = normStr(req.body?.absence_date);
    const section = normStr(req.body?.section);
    const period_number = Number(req.body?.period_number);
    const absence_type = normStr(req.body?.absence_type) || "UNJUSTIFIED";
    const created_by = req.user?.id || null;

    if (!student_id || !absence_date || !section || !period_number) {
      return res.status(400).json({ message: "البيانات المطلوبة غير متوفرة" });
    }

    if (period_number < 1 || period_number > 8) {
      return res.status(400).json({ message: "رقم الفترة يجب أن يكون بين 1 و 8" });
    }

    if (!["JUSTIFIED", "UNJUSTIFIED"].includes(absence_type)) {
      return res.status(400).json({ message: "نوع الغياب غير صالح" });
    }

    const [[student]] = await pool.execute(
      "SELECT id, level, class_name FROM students WHERE id = ?",
      [student_id]
    );
    if (!student) {
      return res.status(404).json({ message: "الطالب غير موجود" });
    }
    const weeklyAllowed = await getAllowedPeriodsForDate();
    const { map: studyMap } = await loadStudyPeriodsMap(pool, absence_date);
    const classCycleCache = new Map();
    const cycle = await findCycleForClass(pool, student.level, student.class_name, classCycleCache);
    const allowedSet = resolveAllowedSetForCycle(cycle, studyMap, weeklyAllowed);
    if (!allowedSet.has(period_number)) {
      return res.status(400).json({ message: "الحصة غير مفعلة حسب الجدولة" });
    }

    const [r] = await pool.execute(
      `INSERT INTO absences (student_id, absence_date, section, period_number, absence_type, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [student_id, absence_date, section, period_number, absence_type, created_by]
    );

    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    res.status(500).json({ message: "خطأ في إنشاء الغياب", error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرف غير صالح" });

    const absence_date = normStr(req.body?.absence_date);
    const section = normStr(req.body?.section);
    const period_number = Number(req.body?.period_number);
    const absence_type = normStr(req.body?.absence_type);

    if (!absence_date || !section || !period_number) {
      return res.status(400).json({ message: "البيانات المطلوبة غير متوفرة" });
    }

    if (period_number < 1 || period_number > 8) {
      return res.status(400).json({ message: "رقم الفترة يجب أن يكون بين 1 و 8" });
    }

    if (absence_type && !["JUSTIFIED", "UNJUSTIFIED"].includes(absence_type)) {
      return res.status(400).json({ message: "نوع الغياب غير صالح" });
    }

    const [r] = await pool.execute(
      `UPDATE absences
       SET absence_date=?, section=?, period_number=?, absence_type=?
       WHERE id=?`,
      [absence_date, section, period_number, absence_type, id]
    );

    if (r.affectedRows === 0) return res.status(404).json({ message: "الغائب غير موجود" });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "خطأ في تحديث الغياب", error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرف غير صالح" });

    const [r] = await pool.execute("DELETE FROM absences WHERE id=?", [id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: "الغائب غير موجود" });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "خطأ في حذف الغياب", error: e.message });
  }
};

exports.stats = async (req, res) => {
  try {
    const [[totalRow]] = await pool.execute(
      `SELECT COUNT(*) AS total
         FROM students
        WHERE status IN ('STUDYING','INCOMING','REFERRED','ADDED')`
    );

    const [[absentTodayRow]] = await pool.execute(
      `SELECT COUNT(DISTINCT a.student_id) AS absent_students
         FROM absences a
         JOIN students s ON s.id = a.student_id
        WHERE a.absence_date = CURDATE()
          AND s.status IN ('STUDYING','INCOMING','REFERRED','ADDED')`
    );

    const totalStudents = Number(totalRow?.total || 0);
    const absentStudentsToday = Number(absentTodayRow?.absent_students || 0);
    const absenceRateTodayPercent =
      totalStudents > 0 ? Math.round((absentStudentsToday / totalStudents) * 10000) / 100 : 0;

    const [byDay] = await pool.execute(`
      SELECT DATE(absence_date) AS date, COUNT(*) AS count
      FROM absences
      WHERE absence_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE(absence_date)
      ORDER BY date DESC
    `);

    const [bySection] = await pool.execute(`
      SELECT section, COUNT(*) AS count
      FROM absences
      GROUP BY section
      ORDER BY count DESC
    `);

    const [byMonth] = await pool.execute(`
      SELECT DATE_FORMAT(absence_date, '%Y-%m') AS month, COUNT(*) AS count
      FROM absences
      WHERE absence_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(absence_date, '%Y-%m')
      ORDER BY month DESC
    `);

    const [mostAbsent] = await pool.execute(`
      SELECT s.full_name, s.massar_code, COUNT(a.id) AS absence_count
      FROM absences a
      JOIN students s ON a.student_id = s.id
      GROUP BY a.student_id, s.full_name, s.massar_code
      ORDER BY absence_count DESC
      LIMIT 10
    `);

    // Absence by subject - Get distinct subjects from timetable where absences occurred
    const [bySubject] = await pool.execute(`
      SELECT 
        subj.id,
        subj.name_ar AS subject_name,
        subj.code AS subject_code,
        COUNT(DISTINCT a.id) AS absence_count,
        COUNT(DISTINCT a.student_id) AS unique_students
      FROM absences a
      INNER JOIN students s ON a.student_id = s.id
      INNER JOIN classes c ON c.classe = s.class_name AND c.is_active = 1
      INNER JOIN timetables t ON t.class_id = c.id
      INNER JOIN timetable_periods tp ON tp.id = t.period_id AND tp.order = a.period_number AND tp.is_active = 1
      INNER JOIN timetable_days td ON td.id = t.day_id AND td.is_active = 1 AND DAYNAME(DATE(a.absence_date)) = ELT(td.\`order\` + 1, 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')
      INNER JOIN subjects subj ON subj.id = t.subject_id
      WHERE a.absence_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY subj.id, subj.name_ar, subj.code
      ORDER BY absence_count DESC
      LIMIT 10
    `);

    res.json({
      today: {
        date: new Date().toISOString().slice(0, 10),
        absent_students: absentStudentsToday,
        total_students: totalStudents,
        rate_percent: absenceRateTodayPercent,
      },
      byDay,
      bySection,
      byMonth,
      mostAbsent,
      bySubject,
    });
  } catch (e) {
    res.status(500).json({ message: "خطأ في جلب الإحصائيات", error: e.message });
  }
};

exports.getStudentAbsences = async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!studentId) return res.status(400).json({ message: "معرف الطالب غير صالح" });

  const [rows] = await pool.execute(
    `SELECT a.id, a.absence_date, a.section, a.period_number, a.absence_type, a.created_at
       FROM absences a
      WHERE a.student_id = ?
      ORDER BY a.absence_date DESC`,
    [studentId]
  );

  res.json({ data: rows });
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function mimeFromExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function schoolYearStartYearFromQuery(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  return m >= 9 ? y : y - 1;
}

exports.getStudentAbsenceCardPdf = async (req, res) => {
  const studentId = Number(req.params.studentId);
  const userId = req.user?.id;
  const userRole = req.user?.role;
  logger.info(`[PDF] userId=${userId} role=${userRole} studentId=${studentId}`);
  if (!studentId) {
    logger.error("[PDF] Invalid studentId", { studentId, userId, userRole });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(400).json({ message: "معرّف غير صالح" });
  }

  const startYear = schoolYearStartYearFromQuery(req.query.start_year);
  const months = [
    { year: startYear, month: 9, label: `شتنبر ${startYear}` },
    { year: startYear, month: 10, label: `أكتوبر ${startYear}` },
    { year: startYear, month: 11, label: `نونبر ${startYear}` },
    { year: startYear, month: 12, label: `دجنبر ${startYear}` },
    { year: startYear + 1, month: 1, label: `يناير ${startYear + 1}` },
    { year: startYear + 1, month: 2, label: `فبراير ${startYear + 1}` },
    { year: startYear + 1, month: 3, label: `مارس ${startYear + 1}` },
    { year: startYear + 1, month: 4, label: `أبريل ${startYear + 1}` },
    { year: startYear + 1, month: 5, label: `ماي ${startYear + 1}` },
    { year: startYear + 1, month: 6, label: `يونيو ${startYear + 1}` },
  ];

  const monthNamesAr = {
    1: "يناير",
    2: "فبراير",
    3: "مارس",
    4: "أبريل",
    5: "ماي",
    6: "يونيو",
    7: "يوليوز",
    8: "غشت",
    9: "شتنبر",
    10: "أكتوبر",
    11: "نونبر",
    12: "دجنبر",
  };
  for (const m of months) {
    m.label = `${monthNamesAr[m.month] || m.month} ${m.year}`;
  }

  const [[student]] = await pool.execute(
    `SELECT id, class_number, massar_code, full_name, level, class_name
       FROM students
      WHERE id=?`,
    [studentId]
  );
  if (!student) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(404).json({ message: "التلميذ غير موجود" });
  }

  const [[settings]] = await pool.execute("SELECT site_name, site_logo_url FROM settings WHERE id=1");
  const siteName = settings?.site_name || "";
  const logoUrl = settings?.site_logo_url || null;

  let logoDataUrl = "";
  try {
    //console.log(`[PDF] Génération PDF pour studentId=${studentId} par userId=${userId} (${userRole})`);
    if (logoUrl && String(logoUrl).startsWith("/uploads/")) {
      const filename = path.basename(String(logoUrl));
      const abs = path.join(__dirname, "..", "uploads", filename);
      if (fs.existsSync(abs)) {
        const buf = fs.readFileSync(abs);
        const mime = mimeFromExt(path.extname(filename));
        logoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      }
    }
  } catch { }

  const from = `${startYear}-09-01`;
  const to = `${startYear + 1}-06-30`;

  const [absenceRows] = await pool.execute(
    `SELECT DATE_FORMAT(absence_date, '%Y-%m-%d') AS absence_date, period_number, absence_type
       FROM absences
      WHERE student_id=?
        AND absence_date BETWEEN ? AND ?
      ORDER BY absence_date ASC`,
    [studentId, from, to]
  );

  const summaryByDate = {};
  for (const a of absenceRows) {
    const key = String(a.absence_date || "").slice(0, 10);
    if (!key) continue;
    if (!summaryByDate[key]) summaryByDate[key] = { periods: new Set(), hasJustified: false, hasUnjustified: false };
    const period = Number(a.period_number);
    if (Number.isFinite(period) && period > 0) summaryByDate[key].periods.add(period);
    const type = String(a.absence_type || "").toUpperCase();
    if (type === "JUSTIFIED") summaryByDate[key].hasJustified = true;
    if (type === "UNJUSTIFIED") summaryByDate[key].hasUnjustified = true;
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function cellValue(year, month, day) {
    if (day > daysInMonth(year, month)) return null;
    const key = `${year}-${pad2(month)}-${pad2(day)}`;
    const s = summaryByDate[key];
    if (!s) return 0;
    return s.periods.size;
  }

  function cellType(year, month, day) {
    const key = `${year}-${pad2(month)}-${pad2(day)}`;
    const s = summaryByDate[key];
    if (!s) return null;
    if (s.hasUnjustified) return "UNJUSTIFIED";
    if (s.hasJustified) return "JUSTIFIED";
    return null;
  }

  function cellBg(hours, type) {
    if (!hours) return "";
    if (type === "JUSTIFIED") return hours >= 5 ? "bg-green-700" : hours >= 3 ? "bg-green-600" : "bg-green-500";
    return hours >= 5 ? "bg-red-700" : hours >= 3 ? "bg-red-600" : "bg-red-500";
  }

  const dayHeaders = Array.from({ length: 31 }, (_, i) => `<th class="th-day">${i + 1}</th>`).join("");
  const rowsHtml = months
    .map((m) => {
      const maxDay = daysInMonth(m.year, m.month);
      const cells = Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        if (day > maxDay) return `<td class="td-day"></td>`;
        const hours = cellValue(m.year, m.month, day);
        const type = cellType(m.year, m.month, day);
        const bg = cellBg(hours, type);
        const cls = hours ? `cell ${bg}` : "cell";
        const title = hours ? `${m.label} - ${day}: ${hours} ساعة` : "";
        return `<td class="td-day"><div class="${cls}" title="${escapeHtml(title)}">${hours ? hours : ""}</div></td>`;
      }).join("");
      return `<tr><td class="td-month">${escapeHtml(m.label)}</td>${cells}</tr>`;
    })
    .join("");

  function buildTable(dayStart, dayEnd) {
    const dayHeaders = Array.from({ length: dayEnd - dayStart + 1 }, (_, i) => {
      const day = dayStart + i;
      return `<th class="th-day">${day}</th>`;
    }).join("");

    const rows = months
      .map((m) => {
        const maxDay = daysInMonth(m.year, m.month);
        const cells = Array.from({ length: dayEnd - dayStart + 1 }, (_, i) => {
          const day = dayStart + i;
          if (day > maxDay) return `<td class="td-day"></td>`;
          const hours = cellValue(m.year, m.month, day);
          const type = cellType(m.year, m.month, day);
          const bg = cellBg(hours, type);
          const cls = hours ? `cell ${bg}` : "cell";
          return `<td class="td-day"><div class="${cls}">${hours ? hours : ""}</div></td>`;
        }).join("");
        return `<tr><td class="td-month">${escapeHtml(m.label)}</td>${cells}</tr>`;
      })
      .join("");

    return `<table>
      <thead><tr><th class="th-month">الشهر</th>${dayHeaders}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }
  // Allow requesting a single table and/or landscape via query params
  const isLandscape = ["1", "true", "yes", "on"].includes(String(req.query.landscape ?? "").toLowerCase());
  const singleTable = ["1", "true", "yes", "on"].includes(String(req.query.single ?? req.query.single_table ?? "").toLowerCase());

  const tablesHtml = singleTable ? buildTable(1, 31) : `${buildTable(1, 16)}<div class="table-gap"></div>${buildTable(17, 31)}`;

  const pageCss = `@page { size: A4 ${isLandscape ? 'landscape' : 'portrait'}; margin: 2mm; }`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>بطاقة غياب</title>
  <style>
    ${pageCss}
    body { font-family: Arial, sans-serif; color: #111827; }
    .header { display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 12px; }
    .brand { display:flex; align-items:center; gap:10px; }
    .logo { width: 44px; height: 44px; object-fit: cover; border-radius: 10px; border: 1px solid #e5e7eb; background:#fff; }
    .site { font-weight:700; }
    .meta { font-size: 12px; color:#374151; line-height: 1.6; }
    .meta b { font-weight:700; }
    .legend { font-size: 12px; color:#4b5563; display:flex; gap:14px; align-items:center; margin: 8px 0 10px; }
    .dot { width: 10px; height: 10px; border-radius: 999px; display:inline-block; }
    .dot-green { background:#16a34a; }
    .dot-red { background:#dc2626; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #e5e7eb; }
    * { box-sizing: border-box; }
    .th-month { width: 110px; background:#f9fafb; font-size: 11px; padding: 4px; text-align: right; }
    .th-day { width: 18px; background:#f9fafb; font-size: 10px; padding: 2px 0; text-align:center; }
    .td-month { font-size: 11px; padding: 4px; white-space: nowrap; }
    .td-day { padding: 1px; height: 18px; }
    .cell { width: 100%; height: 16px; border-radius: 3px; border: 1px solid #e5e7eb; display:flex; align-items:center; justify-content:center; font-size: 10px; color:#111827; }
    .bg-green-500{ background:#22c55e; border-color:#22c55e; color:#fff;}
    .bg-green-600{ background:#16a34a; border-color:#16a34a; color:#fff;}
    .bg-green-700{ background:#15803d; border-color:#15803d; color:#fff;}
    .bg-red-500{ background:#ef4444; border-color:#ef4444; color:#fff;}
    .bg-red-600{ background:#dc2626; border-color:#dc2626; color:#fff;}
    .bg-red-700{ background:#b91c1c; border-color:#b91c1c; color:#fff;}
    .table-gap { height: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="logo" />` : ""}
      <div>
        <div class="site">${escapeHtml(siteName)}</div>
        <div class="meta">بطاقة غياب التلميذ</div>
      </div>
    </div>
    <div class="meta">
      <div><b>الاسم:</b> ${escapeHtml(student.full_name)}</div>
      <div><b>رقم مسار:</b> ${escapeHtml(student.massar_code)}</div>
      <div><b>المستوى:</b> ${escapeHtml(student.level)}</div>
      <div><b>القسم:</b> ${escapeHtml(student.class_name)}</div>
      ${student.class_number !== null && student.class_number !== undefined ? `<div><b>الرقم:</b> ${escapeHtml(student.class_number)}</div>` : ""}
    </div>
  </div>
  <div class="legend">
    <span><span class="dot dot-green"></span> مبرر</span>
    <span><span class="dot dot-red"></span> غير مبرر</span>
    <span>الساعات = عدد الحصص</span>
  </div>
  ${tablesHtml}
</body>
</html>`;

  const htmlAr = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>بطاقة الغياب السنوية</title>
  <style>
    ${pageCss}
    body { font-family: Tahoma, Arial, "Segoe UI", sans-serif; color: #0f172a; font-size: 12px; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .logo { width: 46px; height: 46px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
    .site { font-weight: 700; font-size: 14px; }
    .meta { color: #334155; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #e2e8f0; padding: 3px; text-align: center; }
    th { background: #f1f5f9; font-weight: 700; }
    .th-month { width: 88px; text-align: right; }
    .cell { width: 100%; height: 16px; border-radius: 3px; border: 1px solid #e2e8f0; display:flex; align-items:center; justify-content:center; font-size: 10px; color:#0f172a; }
    .cell-empty { background: #f8fafc; color: #94a3b8; }
    .cell-green { background: #16a34a; border-color: #16a34a; color: #fff; }
    .cell-red { background: #dc2626; border-color: #dc2626; color: #fff; }
    .bg-green-500{ background:#22c55e; border-color:#22c55e; color:#fff;}
    .bg-green-600{ background:#16a34a; border-color:#16a34a; color:#fff;}
    .bg-green-700{ background:#15803d; border-color:#15803d; color:#fff;}
    .bg-red-500{ background:#ef4444; border-color:#ef4444; color:#fff;}
    .bg-red-600{ background:#dc2626; border-color:#dc2626; color:#fff;}
    .bg-red-700{ background:#b91c1c; border-color:#b91c1c; color:#fff;}
    .legend { display: flex; align-items: center; gap: 14px; margin: 6px 0 10px; color: #475569; }
    .dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; margin-left: 6px; vertical-align: middle; }
    .dot-green { background: #16a34a; }
    .dot-red { background: #dc2626; }
    .table-gap { height: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="logo" />` : ""}
      <div>
        <div class="site">${escapeHtml(siteName)}</div>
        <div class="meta">بطاقة الغياب السنوية (${startYear}/${startYear + 1})</div>
      </div>
    </div>
    <div class="meta">
      <div><b>التلميذ:</b> ${escapeHtml(student.full_name)}</div>
      <div><b>رمز مسار:</b> ${escapeHtml(student.massar_code)}</div>
      <div><b>المستوى:</b> ${escapeHtml(student.level)}</div>
      <div><b>القسم:</b> ${escapeHtml(student.class_name)}</div>
      ${student.class_number !== null && student.class_number !== undefined ? `<div><b>الرقم:</b> ${escapeHtml(student.class_number)}</div>` : ""}
    </div>
  </div>

  <div class="legend">
    <span><span class="dot dot-green"></span>غياب مبرر</span>
    <span><span class="dot dot-red"></span>غياب غير مبرر</span>
    <span>الرقم = عدد ساعات الغياب</span>
  </div>

  ${tablesHtml}
</body>
</html>`;

  let browser;
  try {
    // Make puppeteer launch options configurable for environments where
    // the bundled Chromium is not available (Windows, CI, etc.).
    const launchOptions = { headless: true };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!process.env.PUPPETEER_SKIP_SANDBOX) launchOptions.args = ["--no-sandbox", "--disable-setuid-sandbox"];

    try {
      browser = await puppeteer.launch(launchOptions);
    } catch (err) {
      console.error("[absences/pdf] puppeteer.launch failed, retrying without sandbox args:", err.message);
      const fallback = { headless: true };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) fallback.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      browser = await puppeteer.launch(fallback);
    }

    const page = await browser.newPage();
    await page.setContent(htmlAr, { waitUntil: "load", timeout: 60000 });
    const pdf = await page.pdf({
      format: "A4",
      landscape: !!isLandscape,
      preferCSSPageSize: true,
      printBackground: true,
    });

    const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);

    const download = ["1", "true", "yes"].includes(normStr(req.query.download).toLowerCase());
    const rawName = String(student.full_name || "absence-card").replace(/[\\/:*?"<>|]+/g, " ").trim();

    // HTTP headers must be ASCII-safe; use RFC 5987 for UTF-8 names.
    const asciiName = rawName
      .replace(/[^\x20-\x7E]+/g, " ")
      .replace(/[\\"]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const filenameBaseAscii = asciiName || `student-${studentId}`;
    const filenameUtf8 = encodeURIComponent(`absence-${rawName}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename=\"absence-${filenameBaseAscii}.pdf\"; filename*=UTF-8''${filenameUtf8}`
    );
    res.end(pdfBuffer);
  } catch (e) {
    console.error(`[absences/pdf] failed for userId=${userId} role=${userRole} studentId=${studentId}:`, e);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(500).json({ message: "فشل إنشاء PDF", error: e.message });
  } finally {
    try {
      await browser?.close();
    } catch { }
  }
};

exports.sendStudentAbsenceCardPdfWhatsApp = async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!studentId) return res.status(400).json({ message: "رقم التلميذ غير صحيح" });

  const startYear = schoolYearStartYearFromQuery(req.body?.start_year ?? req.query.start_year);
  const isLandscape = ["1", "true", "yes", "on"].includes(String(req.body?.landscape ?? req.query.landscape ?? "").toLowerCase());
  const singleTable = ["1", "true", "yes", "on"].includes(String(req.body?.single ?? req.body?.single_table ?? req.query.single ?? req.query.single_table ?? "").toLowerCase());

  const [[student]] = await pool.execute(
    `SELECT id, class_number, massar_code, full_name, level, class_name, father_phone, mother_phone, guardian_phone
       FROM students
      WHERE id=?`,
    [studentId]
  );
  if (!student) return res.status(404).json({ message: "التلميذ غير موجود" });

  const [[settings]] = await pool.execute("SELECT site_name, site_logo_url FROM settings WHERE id=1");
  const siteName = settings?.site_name || "";
  const logoUrl = settings?.site_logo_url || null;

  let logoDataUrl = "";
  try {
    if (logoUrl && String(logoUrl).startsWith("/uploads/")) {
      const filename = path.basename(String(logoUrl));
      const abs = path.join(__dirname, "..", "uploads", filename);
      if (fs.existsSync(abs)) {
        const buf = fs.readFileSync(abs);
        const mime = mimeFromExt(path.extname(filename));
        logoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      }
    }
  } catch { }

  const months = [
    { year: startYear, month: 9 },
    { year: startYear, month: 10 },
    { year: startYear, month: 11 },
    { year: startYear, month: 12 },
    { year: startYear + 1, month: 1 },
    { year: startYear + 1, month: 2 },
    { year: startYear + 1, month: 3 },
    { year: startYear + 1, month: 4 },
    { year: startYear + 1, month: 5 },
    { year: startYear + 1, month: 6 },
  ];
  const monthNamesAr = {
    1: "يناير",
    2: "فبراير",
    3: "مارس",
    4: "أبريل",
    5: "ماي",
    6: "يونيو",
    7: "يوليوز",
    8: "غشت",
    9: "شتنبر",
    10: "أكتوبر",
    11: "نونبر",
    12: "دجنبر",
  };
  for (const m of months) m.label = `${monthNamesAr[m.month] || m.month} ${m.year}`;

  const from = `${startYear}-09-01`;
  const to = `${startYear + 1}-06-30`;
  const [absenceRows] = await pool.execute(
    `SELECT DATE_FORMAT(absence_date, '%Y-%m-%d') AS absence_date, period_number, absence_type
       FROM absences
      WHERE student_id=?
        AND absence_date BETWEEN ? AND ?
      ORDER BY absence_date ASC`,
    [studentId, from, to]
  );

  const summaryByDate = {};
  for (const a of absenceRows) {
    const key = String(a.absence_date || "").slice(0, 10);
    if (!key) continue;
    if (!summaryByDate[key]) summaryByDate[key] = { periods: new Set(), hasJustified: false, hasUnjustified: false };
    const period = Number(a.period_number);
    if (Number.isFinite(period) && period > 0) summaryByDate[key].periods.add(period);
    const type = String(a.absence_type || "").toUpperCase();
    if (type === "JUSTIFIED") summaryByDate[key].hasJustified = true;
    if (type === "UNJUSTIFIED") summaryByDate[key].hasUnjustified = true;
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function cellValue(year, month, day) {
    if (day > daysInMonth(year, month)) return null;
    const key = `${year}-${pad2(month)}-${pad2(day)}`;
    const s = summaryByDate[key];
    if (!s) return 0;
    return s.periods.size;
  }

  function cellType(year, month, day) {
    const key = `${year}-${pad2(month)}-${pad2(day)}`;
    const s = summaryByDate[key];
    if (!s) return null;
    if (s.hasUnjustified) return "UNJUSTIFIED";
    if (s.hasJustified) return "JUSTIFIED";
    return null;
  }

  function cellBg(hours, type) {
    if (!hours) return "";
    if (type === "JUSTIFIED") return hours >= 5 ? "bg-green-700" : hours >= 3 ? "bg-green-600" : "bg-green-500";
    return hours >= 5 ? "bg-red-700" : hours >= 3 ? "bg-red-600" : "bg-red-500";
  }

  function buildTable(dayStart, dayEnd) {
    const dayHeaders = Array.from({ length: dayEnd - dayStart + 1 }, (_, i) => {
      const day = dayStart + i;
      return `<th class="th-day">${day}</th>`;
    }).join("");

    const rows = months
      .map((m) => {
        const maxDay = daysInMonth(m.year, m.month);
        const cells = Array.from({ length: dayEnd - dayStart + 1 }, (_, i) => {
          const day = dayStart + i;
          if (day > maxDay) return `<td class="td-day"></td>`;
          const hours = cellValue(m.year, m.month, day);
          const type = cellType(m.year, m.month, day);
          const bg = cellBg(hours, type);
          const cls = hours ? `cell ${bg}` : "cell";
          return `<td class="td-day"><div class="${cls}">${hours ? hours : ""}</div></td>`;
        }).join("");
        return `<tr><td class="td-month">${escapeHtml(m.label)}</td>${cells}</tr>`;
      })
      .join("");

    return `<table>
      <thead><tr><th class="th-month">الشهر</th>${dayHeaders}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // In portrait, 31 day-columns get clipped. Use split tables unless single requested.
  const tablesHtml = singleTable ? buildTable(1, 31) : `${buildTable(1, 16)}<div class="table-gap"></div>${buildTable(17, 31)}`;

  const pageCss = `@page { size: A4 ${isLandscape ? 'landscape' : 'portrait'}; margin: 6mm; }`;

  const htmlAr = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>بطاقة الغياب السنوية</title>
  <style>
    ${pageCss}
    body { font-family: Tahoma, Arial, "Segoe UI", sans-serif; color: #0f172a; font-size: 12px; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .logo { width: 46px; height: 46px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
    .site { font-weight: 700; font-size: 14px; }
    .meta { color: #334155; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #e2e8f0; padding: 3px; text-align: center; }
    th { background: #f1f5f9; font-weight: 700; }
    .th-month { width: 88px; text-align: right; }
    .cell { width: 100%; height: 16px; border-radius: 3px; border: 1px solid #e2e8f0; display:flex; align-items:center; justify-content:center; font-size: 10px; color:#0f172a; }
    .cell-empty { background: #f8fafc; color: #94a3b8; }
    .cell-green { background: #16a34a; border-color: #16a34a; color: #fff; }
    .cell-red { background: #dc2626; border-color: #dc2626; color: #fff; }
    .bg-green-500{ background:#22c55e; border-color:#22c55e; color:#fff;}
    .bg-green-600{ background:#16a34a; border-color:#16a34a; color:#fff;}
    .bg-green-700{ background:#15803d; border-color:#15803d; color:#fff;}
    .bg-red-500{ background:#ef4444; border-color:#ef4444; color:#fff;}
    .bg-red-600{ background:#dc2626; border-color:#dc2626; color:#fff;}
    .bg-red-700{ background:#b91c1c; border-color:#b91c1c; color:#fff;}
    .legend { display: flex; align-items: center; gap: 14px; margin: 6px 0 10px; color: #475569; }
    .dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; margin-left: 6px; vertical-align: middle; }
    .dot-green { background: #16a34a; }
    .dot-red { background: #dc2626; }
    .table-gap { height: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="logo" />` : ""}
      <div>
        <div class="site">${escapeHtml(siteName)}</div>
        <div class="meta">بطاقة الغياب السنوية (${startYear}/${startYear + 1})</div>
      </div>
    </div>
    <div class="meta">
      <div><b>التلميذ:</b> ${escapeHtml(student.full_name)}</div>
      <div><b>رمز مسار:</b> ${escapeHtml(student.massar_code)}</div>
      <div><b>المستوى:</b> ${escapeHtml(student.level)}</div>
      <div><b>القسم:</b> ${escapeHtml(student.class_name)}</div>
      ${student.class_number !== null && student.class_number !== undefined ? `<div><b>الرقم:</b> ${escapeHtml(student.class_number)}</div>` : ""}
    </div>
  </div>

  <div class="legend">
    <span><span class="dot dot-green"></span>غياب مبرر</span>
    <span><span class="dot dot-red"></span>غياب غير مبرر</span>
    <span>الرقم = عدد ساعات الغياب</span>
  </div>

  ${tablesHtml}
</body>
</html>`;

  let browser;
  try {
    const launchOptions = { headless: true };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!process.env.PUPPETEER_SKIP_SANDBOX) launchOptions.args = ["--no-sandbox", "--disable-setuid-sandbox"];

    try {
      browser = await puppeteer.launch(launchOptions);
    } catch (err) {
      logger.error("[absences/pdf/send] puppeteer.launch failed, retrying without sandbox args: %s", err.message);
      const fallback = { headless: true };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) fallback.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      browser = await puppeteer.launch(fallback);
    }

    const page = await browser.newPage();
    await page.setContent(htmlAr, { waitUntil: "load", timeout: 60000 });
    const pdf = await page.pdf({
      format: "A4",
      landscape: !!isLandscape,
      preferCSSPageSize: true,
      printBackground: true,
    });
    const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);

    const phoneCandidates = [];
    if (req.body?.to) phoneCandidates.push(req.body.to);
    if (Array.isArray(req.body?.phones)) phoneCandidates.push(...req.body.phones);

    const targets = Array.isArray(req.body?.targets) ? req.body.targets.map((x) => String(x).toLowerCase()) : null;
    const wantFather = !targets || targets.includes("father") || targets.includes("father_phone");
    const wantMother = !targets || targets.includes("mother") || targets.includes("mother_phone");
    const wantGuardian = !targets || targets.includes("guardian") || targets.includes("guardian_phone");

    if (!req.body?.to && !Array.isArray(req.body?.phones)) {
      if (wantFather) phoneCandidates.push(student.father_phone);
      if (wantMother) phoneCandidates.push(student.mother_phone);
      if (wantGuardian) phoneCandidates.push(student.guardian_phone);
    }

    const uniquePhones = Array.from(
      new Set(
        phoneCandidates
          .map((p) => (p === null || p === undefined ? "" : String(p).trim()))
          .filter(Boolean)
      )
    );
    if (uniquePhones.length === 0) return res.status(400).json({ message: "لا توجد أرقام هاتف للإرسال" });

    const safeName = String(student.full_name || `student-${studentId}`).replace(/[\\/:*?"<>|]+/g, " ").trim();
    const mediaFilename = `absence-${safeName}.pdf`;
    const mediaBase64 = pdfBuffer.toString("base64");
    const caption =
      String(req.body?.caption || "").trim() ||
      `بطاقة الغياب السنوية للتلميذ(ة): ${student.full_name} (${startYear}/${startYear + 1})`;

    // حفظ الحملة في قاعدة البيانات
    const messageBody = caption;
    const totalCount = uniquePhones.length;
    const [campResult] = await pool.execute(
      `INSERT INTO campaigns (created_by, audience, mode, message_body, media_path, filter_json, status, total_count, started_at)
       VALUES (?, 'STUDENTS', 'ABSENCE', ?, NULL, NULL, 'SENDING', ?, NOW())`,
      [req.user.id, messageBody, totalCount]
    );
    const campaignId = campResult.insertId;

    const results = [];
    let sentCount = 0;
    let failedCount = 0;
    const logs = [];

    for (const phone of uniquePhones) {
      const digits = toDigitsMorocco(phone);
      const jid = toJid(digits);
      if (!jid) {
        results.push({ phone, skipped: true, reason: "INVALID_PHONE" });
        logs.push({
          campaign_id: campaignId,
          recipient_type: 'PHONE',
          recipient_ref_id: null,
          recipient_name: `رقم: ${phone}`,
          phone: phone,
          vars_json: null,
          wa_jid: null,
          status: 'SKIPPED',
          error_text: 'INVALID_PHONE',
          wa_message_id: null,
          attempt: 0,
          sent_at: null
        });
        failedCount++;
        continue;
      }
      try {
        const r = await sendOne({ jid, text: caption, mediaBase64, mediaMime: "application/pdf", mediaFilename });
        results.push({ phone, digits, jid, ...r });
        if (r.success) {
          sentCount++;
          logs.push({
            campaign_id: campaignId,
            recipient_type: 'PHONE',
            recipient_ref_id: null,
            recipient_name: `رقم: ${phone}`,
            phone: phone,
            vars_json: null,
            wa_jid: jid,
            status: 'SENT',
            error_text: null,
            wa_message_id: r.messageId || null,
            attempt: 1,
            sent_at: new Date()
          });
        } else {
          failedCount++;
          logs.push({
            campaign_id: campaignId,
            recipient_type: 'PHONE',
            recipient_ref_id: null,
            recipient_name: `رقم: ${phone}`,
            phone: phone,
            vars_json: null,
            wa_jid: jid,
            status: 'FAILED',
            error_text: r.error || 'Unknown error',
            wa_message_id: null,
            attempt: 1,
            sent_at: null
          });
        }
      } catch (e) {
        const msg = String(e?.message || e);
        results.push({ phone, digits, jid, error: msg });
        logs.push({
          campaign_id: campaignId,
          recipient_type: 'PHONE',
          recipient_ref_id: null,
          recipient_name: `رقم: ${phone}`,
          phone: phone,
          vars_json: null,
          wa_jid: jid,
          status: 'FAILED',
          error_text: msg,
          wa_message_id: null,
          attempt: 1,
          sent_at: null
        });
        failedCount++;
        if (msg === "WHATSAPP_NOT_READY") {
          // تحديث حالة الحملة
          await pool.execute(
            `UPDATE campaigns SET status='FAILED', sent_count=?, failed_count=?, finished_at=NOW() WHERE id=?`,
            [sentCount, failedCount, campaignId]
          );
          return res.status(503).json({ message: "واتساب غير جاهز حاليا (قم بمسح QR)", results });
        }
      }
    }

    // حفظ السجلات
    if (logs.length > 0) {
      const placeholders = logs.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const values = [];
      logs.forEach(log => {
        values.push(
          log.campaign_id,
          log.recipient_type,
          log.recipient_ref_id,
          log.recipient_name,
          log.phone,
          log.vars_json,
          log.wa_jid,
          log.status,
          log.error_text,
          log.wa_message_id,
          log.attempt,
          log.sent_at
        );
      });
      await pool.execute(
        `INSERT INTO message_logs
          (campaign_id, recipient_type, recipient_ref_id, recipient_name, phone, vars_json, wa_jid,
           status, error_text, wa_message_id, attempt, sent_at)
         VALUES ${placeholders}`,
        values
      );
    }

    // تحديث الحملة بعدد الرسائل المرسلة والفاشلة
    const finalStatus = failedCount === totalCount ? 'FAILED' : 'DONE';
    await pool.execute(
      `UPDATE campaigns SET status=?, sent_count=?, failed_count=?, finished_at=NOW() WHERE id=?`,
      [finalStatus, sentCount, failedCount, campaignId]
    );

    return res.json({ ok: true, campaignId, results });
  } catch (e) {
    logger.error("[sendStudentAbsenceCardPdfWhatsApp] Error:", e);
    return res.status(500).json({ message: "فشل إرسال البطاقة", error: e.message });
  } finally {
    try {
      await browser?.close();
    } catch { }
  }
};

exports.getAbsentOnDate = async (req, res) => {
  const date = normStr(req.query.date);
  if (!date) return res.status(400).json({ message: "التاريخ مطلوب" });

  const section = normStr(req.query.section);
  const status = normStr(req.query.status).toUpperCase();
  const absenceType = normStr(req.query.absence_type).toUpperCase();
  const distinctStudents = ["1", "true", "yes"].includes(normStr(req.query.distinct_students).toLowerCase());

  const where = ["a.absence_date = ?"];
  const params = [date];

  if (section) {
    where.push("a.section = ?");
    params.push(section);
  }
  if (status) {
    if (status === "ACTIVE") {
      where.push("s.status IN ('STUDYING','INCOMING','REFERRED','ADDED')");
    } else if (status === "INACTIVE") {
      where.push("s.status NOT IN ('STUDYING','INCOMING','REFERRED','ADDED')");
    } else if (["STUDYING", "INCOMING", "REFERRED", "ADDED", "DELETED", "NOT_ENROLLED", "LEFT", "DROPPED"].includes(status)) {
      where.push("s.status = ?");
      params.push(status);
    }
  }
  if (absenceType && ["JUSTIFIED", "UNJUSTIFIED"].includes(absenceType)) {
    where.push("a.absence_type = ?");
    params.push(absenceType);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  let rows;
  if (distinctStudents) {
    const [r] = await pool.execute(
      `SELECT s.id, s.full_name, s.massar_code, s.level, s.class_name, s.father_phone, s.mother_phone, s.guardian_phone,
              a.section,
              MAX(a.absence_type) AS absence_type,
              COUNT(DISTINCT a.period_number) AS periods_count
         FROM absences a
         JOIN students s ON a.student_id = s.id
        ${whereSql}
        GROUP BY s.id, s.full_name, s.massar_code, s.level, s.class_name, s.father_phone, s.mother_phone, s.guardian_phone, a.section
        ORDER BY s.class_name, s.full_name`,
      params
    );
    rows = r;
  } else {
    const [r] = await pool.execute(
      `SELECT s.id, s.full_name, s.massar_code, s.level, s.class_name, s.father_phone, s.mother_phone, s.guardian_phone,
              a.section, a.period_number, a.absence_type
         FROM absences a
         JOIN students s ON a.student_id = s.id
        ${whereSql}
        ORDER BY s.class_name, s.full_name`,
      params
    );
    rows = r;
  }

  res.json({ data: rows });
};

function ymdToday() {
  return new Date().toISOString().slice(0, 10);
}

function ymdAddDays(ymd, deltaDays) {
  const base = new Date(`${ymd}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(deltaDays || 0));
  return base.toISOString().slice(0, 10);
}

function parseJsonOrNull(v) {
  if (!v) return null;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

function isStudyDayFromWeeklySchedule(schedule, periodsCount, ymd) {
  if (!schedule) return true; // backward compatible (counts calendar days)
  const jsDay = getJsDayFromYMD(ymd);
  if (!jsDay || jsDay === 0) return false; // Sunday

  const days =
    schedule.days && typeof schedule.days === "object" ? schedule.days : schedule;
  const day = days?.[String(jsDay)] || days?.[jsDay];
  if (!day?.enabled) return false;

  const periods =
    day.periods && typeof day.periods === "object" ? day.periods : {};

  for (let p = 1; p <= periodsCount; p++) {
    const cell = periods[String(p)] ?? periods[p];
    if (typeof cell === "boolean") {
      if (cell) return true;
      continue;
    }
    if (typeof cell === "number") {
      if (cell === 1) return true;
      continue;
    }
    if (cell && typeof cell === "object") {
      const start = toHHMM(cell.start);
      const end = toHHMM(cell.end);
      if (start && end) return true;
    }
  }
  return false;
}

function isActiveDayOfWeek(ymd, activeDayIds) {
  // Check if the given date falls on an active/working day of the week
  // activeDayIds is a Set of active day IDs (1-7 where: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun)
  if (!activeDayIds || !activeDayIds.size) return true; // If no active days defined, assume all days work
  const jsDay = getJsDayFromYMD(ymd); // 0=Sun, 1=Mon, ..., 6=Sat
  if (jsDay === null || jsDay === undefined) return false;
  // Convert JS day (0-6) to database day ID (1-7): JS Sun=0 -> DB Sun=7, JS Mon=1 -> DB Mon=1, etc.
  const dbDayId = jsDay === 0 ? 7 : jsDay;
  return activeDayIds.has(dbDayId);
}

function ymdAddStudyDays(schedule, periodsCount, startYmd, deltaStudyDays) {
  const n = Number(deltaStudyDays || 0);
  if (!Number.isFinite(n) || n === 0) return startYmd;
  if (!schedule) return ymdAddDays(startYmd, n);

  let cur = startYmd;
  let remaining = n;
  let guard = 0;
  while (remaining > 0 && guard < 2000) {
    cur = ymdAddDays(cur, 1);
    if (isStudyDayFromWeeklySchedule(schedule, periodsCount, cur)) remaining -= 1;
    guard += 1;
  }
  return cur;
}

function ymdAddActiveDays(startYmd, deltaActiveDays, activeDayIds) {
  const n = Number(deltaActiveDays || 0);
  if (!Number.isFinite(n) || n === 0) return startYmd;
  if (!activeDayIds || !activeDayIds.size) return ymdAddDays(startYmd, n);
  if (!startYmd) return startYmd;

  let cur = startYmd;
  let remaining = n;
  let guard = 0;
  while (remaining > 0 && guard < 2000) {
    cur = ymdAddDays(cur, 1);
    if (isActiveDayOfWeek(cur, activeDayIds)) remaining -= 1;
    guard += 1;
  }
  return cur;
}

function sumAbsenceHoursForFirstStudyDays(schedule, periodsCount, dayHoursMap, startYmd, studyDaysCount) {
  const n = Math.max(0, Number(studyDaysCount || 0));
  if (!n) return 0;
  if (!startYmd) return 0;

  let sum = 0;
  let remaining = n;
  let cur = startYmd;
  let guard = 0;

  while (remaining > 0 && guard < 2000) {
    if (isStudyDayFromWeeklySchedule(schedule, periodsCount, cur)) {
      const h = dayHoursMap?.get?.(cur);
      sum += Math.max(0, Number(h || 0));
      remaining -= 1;
    }
    if (remaining <= 0) break;
    cur = ymdAddDays(cur, 1);
    guard += 1;
  }

  return sum;
}

function sumAbsenceHoursForFirstActiveDays(dayHoursMap, startYmd, activeDaysCount, activeDayIds) {
  const n = Math.max(0, Number(activeDaysCount || 0));
  if (!n) return 0;
  if (!startYmd) return 0;

  let sum = 0;
  let remaining = n;
  let cur = startYmd;
  let guard = 0;

  while (remaining > 0 && guard < 2000) {
    if (isActiveDayOfWeek(cur, activeDayIds)) {
      const h = dayHoursMap?.get?.(cur);
      sum += Math.max(0, Number(h || 0));
      remaining -= 1;
    }
    if (remaining <= 0) break;
    cur = ymdAddDays(cur, 1);
    guard += 1;
  }

  return sum;
}

function formatYmdDMY(ymd) {
  const s = String(ymd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

async function computeAbsenceNoticeCandidates({ asOf, month, year, section, includeInactive, minDays }) {
  let targetAsOf = asOf || ymdToday();
  if (month && year) {
    targetAsOf = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  // Load active study days of the week
  const [activeDaysRows] = await pool.execute(
    "SELECT id FROM timetable_days WHERE Is_active = 1 ORDER BY id"
  );
  const activeDayIds = new Set(activeDaysRows.map(r => Number(r.id)));

  const periodsCount = await getActivePeriodsCount();

  const sw = [];
  const sp = [];
  if (section) {
    sw.push("s.class_name = ?");
    sp.push(section);
  }
  if (!includeInactive) sw.push("s.status IN ('STUDYING','INCOMING','REFERRED','ADDED')");
  const studentsWhere = sw.length ? `WHERE ${sw.join(" AND ")}` : "";

  const [students] = await pool.execute(
    `SELECT s.id, s.full_name, s.class_name, s.class_number, s.massar_code, s.father_phone, s.mother_phone, s.guardian_phone
       FROM students s
      ${studentsWhere}
      ORDER BY s.class_name, s.class_number, s.full_name`,
    sp
  );

  if (!students.length) return [];

  const studentIds = Array.from(new Set(students.map((s) => Number(s.id)).filter(Boolean)));
  if (!studentIds.length) return [];

  const inPlaceholders = studentIds.map(() => "?").join(",");
  const absWhere = [
    `a.student_id IN (${inPlaceholders})`,
    "a.absence_type = 'UNJUSTIFIED'",
    "a.absence_date BETWEEN DATE_SUB(?, INTERVAL 90 DAY) AND ?",
  ];
  const absParams = [...studentIds, targetAsOf, targetAsOf];
  if (section) {
    absWhere.push("a.section = ?");
    absParams.push(section);
  }

  const [absenceDays] = await pool.execute(
    `SELECT a.student_id, DATE_FORMAT(a.absence_date, '%Y-%m-%d') AS d,
            COUNT(DISTINCT a.period_number) AS h
       FROM absences a
      WHERE ${absWhere.join(" AND ")}
      GROUP BY a.student_id, d`,
    absParams
  );

  const daysByStudent = new Map();
  const hoursByStudent = new Map();
  for (const r of absenceDays) {
    const sid = Number(r.student_id);
    const d = String(r.d || "").slice(0, 10);
    if (!sid || !d) continue;
    if (!daysByStudent.has(sid)) daysByStudent.set(sid, new Set());
    daysByStudent.get(sid).add(d);
    const h = Math.max(0, Number(r.h || 0));
    if (!hoursByStudent.has(sid)) hoursByStudent.set(sid, new Map());
    hoursByStudent.get(sid).set(d, h);
  }

  const out = [];
  for (const s of students) {
    const sid = Number(s.id);
    const set = daysByStudent.get(sid);
    if (!set || !set.size) continue;

    // New logic: Find all streaks ending on or before asOf and pick the one with the highest count.
    // We filter for active school days only to ensure streaks aren't broken by weekend "junk" data.
    const sortedAbsDates = Array.from(set)
      .filter((d) => isActiveDayOfWeek(d, activeDayIds))
      .sort();
    let bestStreak = null;

    let currentStreak = [];
    for (let i = 0; i < sortedAbsDates.length; i++) {
      const d = sortedAbsDates[i];
      if (d > targetAsOf) break;

      if (currentStreak.length === 0) {
        currentStreak.push(d);
      } else {
        const prev = currentStreak[currentStreak.length - 1];
        let nextActive = ymdAddDays(prev, 1);
        while (!isActiveDayOfWeek(nextActive, activeDayIds)) {
          nextActive = ymdAddDays(nextActive, 1);
        }
        if (d === nextActive) {
          currentStreak.push(d);
        } else {
          processStreak(currentStreak);
          currentStreak = [d];
        }
      }
    }
    processStreak(currentStreak);

    function processStreak(streak) {
      if (!streak.length) return;
      const count = streak.length;
      if (count < minDays) return;

      const streakEnd = streak[streak.length - 1];

      // If a month/year filter is active, we ensure the streak has SOME activity in that target month.
      // This prevents students from disappearing if their streak continues into the next month.
      if (month && year) {
        const prefix = `${year}-${String(month).padStart(2, "0")}`;
        const hasOverlap = streak.some((d) => d.startsWith(prefix));
        if (!hasOverlap) return;
      }

      // We'll pick the streak with the maximum count. If counts are equal, pick the most recent one.
      if (!bestStreak || count > bestStreak.count || (count === bestStreak.count && streakEnd > bestStreak.end)) {
        bestStreak = {
          count,
          start: streak[0],
          end: streakEnd,
          hoursTotal: streak.reduce((acc, dd) => acc + (hoursByStudent.get(sid)?.get(dd) || 0), 0)
        };
      }
    }

    if (!bestStreak) continue;
    const { count, start: streakStart, end, hoursTotal } = bestStreak;

    const stage = count >= 31 ? 4 : count >= 21 ? 3 : count >= 14 ? 2 : 1;
    const daysThreshold = stage === 4 ? 31 : stage === 3 ? 21 : stage === 2 ? 14 : 7;
    const hoursThreshold = sumAbsenceHoursForFirstActiveDays(
      hoursByStudent.get(sid),
      streakStart,
      daysThreshold,
      activeDayIds
    );

    out.push({
      student: {
        id: sid,
        full_name: s.full_name,
        class_name: s.class_name,
        class_number: s.class_number,
        massar_code: s.massar_code,
        father_phone: s.father_phone || null,
        mother_phone: s.mother_phone || null,
        guardian_phone: s.guardian_phone || null,
      },
      asOf,
      streak: { days: count, hours: hoursTotal, start: streakStart, end },
      notice: {
        stage,
        daysThreshold,
        hoursThreshold,
        dates: {
          notice1: ymdAddActiveDays(streakStart, 6, activeDayIds),
          notice2: ymdAddActiveDays(streakStart, 13, activeDayIds),
          warning: ymdAddActiveDays(streakStart, 20, activeDayIds),
          strike: ymdAddActiveDays(streakStart, 30, activeDayIds),
        },
      },
    });
  }

  return out;
}

exports.getAbsenceNoticeCandidates = async (req, res) => {
  const asOf = normStr(req.query.date) || ymdToday();
  const month = Number(req.query.month) || null;
  const year = Number(req.query.year) || null;
  const section = normStr(req.query.section);
  const includeInactive = ["1", "true", "yes"].includes(normStr(req.query.include_inactive).toLowerCase());
  const minDays = Math.max(1, Number(req.query.min_days || 7));

  const data = await computeAbsenceNoticeCandidates({ asOf, month, year, section, includeInactive, minDays });

  const stage = Number(req.query.stage || 0);
  let filteredData = data;
  if (stage > 0) {
    filteredData = data.filter(x => Number(x?.notice?.stage) === stage);
  }

  res.json({ data: filteredData, meta: { asOf, minDays, section: section || null, stage } });
};

exports.getAbsenceNoticesPdf = async (req, res) => {
  let browser;
  try {
    const asOf = normStr(req.body?.date || req.query.date) || ymdToday();
    const month = Number(req.body?.month ?? req.query.month) || null;
    const year = Number(req.body?.year ?? req.query.year) || null;
    const section = normStr(req.body?.section || req.query.section);
    const includeInactive = ["1", "true", "yes"].includes(normStr(req.body?.include_inactive ?? req.query.include_inactive).toLowerCase());
    const minDays = Math.max(1, Number(req.body?.min_days ?? req.query.min_days ?? 7));
    const stage = Number(req.body?.stage ?? req.query.stage ?? 0);
    const selectedIds = Array.isArray(req.body?.student_ids) ? req.body.student_ids.map((x) => Number(x)).filter(Boolean) : null;
    const download = ["1", "true", "yes"].includes(normStr(req.body?.download ?? req.query.download).toLowerCase());

    const [[settings]] = await pool.execute("SELECT site_name, site_logo_url FROM settings WHERE id=1");
    const siteName = settings?.site_name || "مجموعة الرياض 2";
    const logoUrl = settings?.site_logo_url || null;

    let logoDataUrl = "";
    try {
      if (logoUrl && String(logoUrl).startsWith("/uploads/")) {
        const filename = path.basename(String(logoUrl));
        const abs = path.join(__dirname, "..", "uploads", filename);
        if (fs.existsSync(abs)) {
          const buf = fs.readFileSync(abs);
          const mime = mimeFromExt(path.extname(filename));
          logoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        }
      }
    } catch { }

    let items = await computeAbsenceNoticeCandidates({ asOf, month, year, section, includeInactive, minDays });
    if (stage) items = items.filter((x) => Number(x?.notice?.stage) === stage);
    if (selectedIds && selectedIds.length) {
      const set = new Set(selectedIds);
      items = items.filter((x) => set.has(Number(x?.student?.id)));
    }

    const subjectFor = (s) => {
      if (s === 1) return "إشعار بالغياب رقم 01";
      if (s === 2) return "إشعار بالغياب رقم 02";
      if (s === 3) return "إنذار بتشطيب";
      if (s === 4) return "إخبار بتشطيب";
      return "إشعار بالغياب";
    };

    const studentTable = (o) => {
      return `
        <table class="t student">
          <thead>
            <tr>
              <th style="width: 40%">الاسم الكامل</th>
              <th style="width: 25%">القسم</th>
              <th style="width: 10%">الرقم</th>
              <th style="width: 25%">رمز مسار</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${escapeHtml(o.student.full_name)}</td>
              <td style="text-align:center;">${escapeHtml(o.student.class_name)}</td>
              <td style="text-align:center;">${escapeHtml(o.student.class_number ?? "")}</td>
              <td style="text-align:center; font-family: monospace; font-size: 1.1em;">${escapeHtml(o.student.massar_code)}</td>
            </tr>
          </tbody>
        </table>`;
    };

    const tahiya = (o) => {
      return `
        <div class="tahiya">سلام تام بوجود مولانا الإمام المؤيد بالله</div>
        <div class="intro">وبعد، يؤسفني أن أنهي إلى علمكم أن إبنكم/إبنتكم:</div>
      `;
    };

    const bodyFor = (r) => {
      const st = Number(r.notice.stage);
      const commonTahiya = tahiya(r);
      const commonStudent = studentTable(r);

      if (st === 1 || st === 2) {
        const stageName = st === 1 ? "الأول" : "الثاني";
        const days = r.streak.days;
        return `
          ${commonTahiya}
          ${commonStudent}
          <div class="main-body">
            قد تغيب عن الدراسة لمدة <b>${days}</b> أيام دراسية متتالية دون مبرر مقبول.
            وتبعا لذلك، نرجو منكم الحضور عاجلاً إلى مصلحة الإدارة التربوية قصد تسوية وضعية إبنكم (تكم)، 
            وتفادي تعرضه (ها) لتدابير إدارية أخرى.
          </div>
          <div class="wassalam">وبه وجب الاعلام، والسلام.</div>
        `;
      }

      if (st === 3) {
        return `
          ${commonTahiya}
          ${commonStudent}
          <div class="main-body">
            قد استمر في الغياب لمدة بلغت <b>21</b> يوما دراسيا متتاليا، رغم الإشعارات السابقة الموجهة إليكم:
            <ul>
              <li>الإشعار الأول بتاريخ: ${formatYmdDMY(r.notice?.dates?.notice1 || r.streak.start)}</li>
              <li>الإشعار الثاني بتاريخ: ${formatYmdDMY(r.notice?.dates?.notice2 || r.streak.start)}</li>
            </ul>
            وعليه، فإننا نوجه إليكم هذا <b>الإنذار الأخير</b>، ونخبركم أنه في حالة عدم التحاقه (ها) بالدراسة في أجل أقصاه 10 أيام، 
            سيتم التشطيب عليه (ها) بصفة نهائية من سجلات المؤسسة طبقا للقوانين الجاري بها العمل.
          </div>
          <div class="wassalam">وبه وجب الاعلام، والسلام.</div>
        `;
      }

      return `
        ${commonTahiya}
        ${commonStudent}
        <div class="main-body">
          نظرا لاستنفاد جميع الإجراءات القانونية والتربوية المعمول بها، واستمرار تغيب إبنكم (تكم) لمدة بلغت <b>31</b> يوما، 
          وبعد توجيه الإشعارات والإنذار بالتشطيب:
          <ul>
            <li>الإشعار الأول بتاريخ: ${formatYmdDMY(r.notice?.dates?.notice1 || r.streak.start)}</li>
            <li>الإشعار الثاني بتاريخ: ${formatYmdDMY(r.notice?.dates?.notice2 || r.streak.start)}</li>
            <li>الإنذار بالتشطيب بتاريخ: ${formatYmdDMY(r.notice?.dates?.warning || r.streak.start)}</li>
          </ul>
          يؤسفني أن أخبركم أنه قد تم <b>التشطيب النهائي</b> على إبنكم (تكم) من سجلات المؤسسة ابتداء من تاريخ: <b>${formatYmdDMY(r.asOf)}</b>.
        </div>
        <div class="wassalam">وبه وجب الاعلام، والسلام.</div>
      `;
    };

    const noticeBlock = (r) => `
      <div class="notice">
        <div class="gov-header">

          <div class="gh-center">
            ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="logo" />` : ""}
          </div>

        </div>

        <div class="doc-title">
          <span>${escapeHtml(subjectFor(Number(r.notice.stage)))}</span>
        </div>

        <div class="body-content">
          ${bodyFor(r)}
        </div>

        <div class="signature-section">
          <div class="sign-box">
             <div class="sign-label">توقيع الإدارة:</div>
             <div class="sign-stamp"></div>
          </div>
        </div>
      </div>
    `;

    const pages = items
      .map((r) => {
        const block = noticeBlock(r);
        return `
          <div class="page">
            <div class="sheet">
              <div class="copy">${block}</div>
              <div class="cut-line"></div>
              <div class="copy">${block}</div>
            </div>
          </div>
        `;
      })
      .join("");

    const htmlAr = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap');
    
    @page { size: A4; margin: 0; }
    
    :root {
      --primary: #1e293b;
      --secondary: #64748b;
      --border: #475569;
      --bg-soft: #f8fafc;
    }

    body {
      font-family: 'Amiri', serif;
      margin: 0;
      padding: 0;
      color: var(--primary);
      background: #fff;
      direction: rtl;
    }

    .page { page-break-after: always; height: 297mm; width: 210mm; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box; }
    .page:last-child { page-break-after: auto; }

    .sheet { padding: 4mm; flex: 1; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; }

    .copy { height: 140mm; position: relative; border: 1px solid #f1f5f9; padding: 4mm; display: flex; flex-direction: column; box-sizing: border-box; }
    
    .cut-line { 
      border-top: 1px dashed #94a3b8; 
      margin: 2mm 0; 
      position: relative; 
      text-align: center;
    }

    .gov-header { display: flex; justify-content: center; align-items: flex-start; margin-bottom: 3mm; }
    .gh-center { display: flex; justify-content: center; }

    .logo { max-height: 22mm; max-width: 45mm; object-fit: contain; }

    .doc-title { text-align: center; margin: 3mm 0; }
    .doc-title span { 
      font-size: 20px; 
      font-weight: bold; 
      border-bottom: 3px double #000; 
      padding: 0 15px 2px;
    }

    .tahiya { text-align: center; font-weight: bold; font-size: 14px; margin-bottom: 1mm; }
    .intro { font-size: 14px; margin-bottom: 2mm; }

    .t { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
    .t th, .t td { border: 1.5px solid var(--border); padding: 4px 8px; font-size: 13px; }
    .t th { background: var(--bg-soft); font-weight: bold; text-align: center; }
    .t td { text-align: center; }

    .main-body { font-size: 14.5px; line-height: 1.6; text-align: justify; margin-bottom: 3mm; flex: 1; }
    .main-body ul { margin: 2px 20px; }
    .wassalam { text-align: center; font-weight: bold; font-size: 15px; }

    .signature-section { display: flex; justify-content: flex-start; padding-left: 10mm; margin-top: 2mm; }
    .sign-box { width: 60mm; text-align: center; }
    .sign-label { font-weight: bold; text-decoration: underline; margin-bottom: 10mm; }
    .sign-stamp { border: 1px dashed #cbd5e1; height: 12mm; width: 100%; border-radius: 5px; }

  </style>
</head>
<body>
  ${pages || `<div style="text-align:center; padding:100px;">لا توجد إشعارات حسب الشروط المحددة.</div>`}
</body>
</html>`;

    const html = htmlAr;

    const launchOptions = { headless: true };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!process.env.PUPPETEER_SKIP_SANDBOX) launchOptions.args = ["--no-sandbox", "--disable-setuid-sandbox"];

    try {
      browser = await puppeteer.launch(launchOptions);
    } catch (err) {
      const fallback = { headless: true };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) fallback.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      browser = await puppeteer.launch(fallback);
    }

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 60000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename = "absence-notices.pdf"`);
    res.end(pdfBuffer);
  } catch (e) {
    console.error("=== PDF GENERATION ERROR ===");
    console.error("Error message:", e.message);
    console.error("Error stack:", e.stack);
    console.error("Parameters:", { asOf, section, minDays, stage });
    console.error("============================");
    logger.error("PDF generation error", e, { asOf, section, minDays, stage });
    res.status(500).json({ message: "فشل إنشاء PDF", error: e.message });
  } finally {
    try {
      await browser?.close();
    } catch { }
  }
};

exports.getAbsencesTable = async (req, res) => {
  const date = normStr(req.query.date);
  const section = normStr(req.query.section);
  const includeInactive = ["1", "true", "yes"].includes(normStr(req.query.include_inactive).toLowerCase());
  if (!date || !section) return res.status(400).json({ message: "التاريخ والقطاع مطلوبان" });

  const where = ["s.class_name = ?"];
  const params = [section];
  if (!includeInactive) where.push("s.status IN ('STUDYING','INCOMING','REFERRED','ADDED')");

  const [students] = await pool.execute(
    `SELECT s.id, s.class_number, s.full_name, s.massar_code
       FROM students s
      WHERE ${where.join(" AND ")}
      ORDER BY s.class_number IS NULL ASC, s.class_number ASC, s.full_name ASC`,
    params
  );

  const [absences] = await pool.execute(
    `SELECT a.student_id, a.period_number, a.absence_type
       FROM absences a
      WHERE a.absence_date = ? AND a.section = ? `,
    [date, section]
  );

  const absenceMap = {};
  absences.forEach((a) => {
    if (!absenceMap[a.student_id]) absenceMap[a.student_id] = {};
    absenceMap[a.student_id][a.period_number] = a.absence_type;
  });

  const tableData = students.map((student) => ({
    student_id: student.id,
    class_number: student.class_number,
    full_name: student.full_name,
    massar_code: student.massar_code,
    periods: {},
  }));

  tableData.forEach((student) => {
    for (let period = 1; period <= 8; period++) {
      student.periods[period] = absenceMap[student.student_id]?.[period] || null;
    }
  });

  res.json({ data: tableData });
};

exports.saveAbsencesTable = async (req, res) => {
  const date = normStr(req.body?.date);
  const section = normStr(req.body?.section);
  const absencesData = req.body?.absences || [];
  const created_by = req.user?.id || null;

  console.log("Saving absences:", { date, section, absencesData: JSON.stringify(absencesData), created_by });

  if (!date || !section) {
    return res.status(400).json({ message: "التاريخ والقطاع مطلوبان" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const weeklyAllowed = await getAllowedPeriodsForDate();
    const { map: studyMap } = await loadStudyPeriodsMap(conn, date);
    const classCycleCache = new Map();

    await conn.execute("DELETE FROM absences WHERE absence_date = ? AND section = ?", [date, section]);

    for (const studentData of absencesData) {
      const studentId = Number(studentData.student_id);
      if (!studentId) continue;

      const [studentRows] = await conn.execute(
        "SELECT id, level, class_name FROM students WHERE id = ?",
        [studentId]
      );
      if (studentRows.length === 0) {
        console.log(`Student ${studentId} not found, skipping`);
        continue;
      }

      const student = studentRows[0];
      const cycle = await findCycleForClass(
        conn,
        student.level,
        student.class_name,
        classCycleCache
      );
      const allowedSet = resolveAllowedSetForCycle(cycle, studyMap, weeklyAllowed);
      if (!allowedSet || !allowedSet.size) continue;

      for (let period = 1; period <= 8; period++) {
        if (!allowedSet.has(period)) continue;
        const absenceType = studentData.periods?.[period];
        if (absenceType && ["JUSTIFIED", "UNJUSTIFIED"].includes(absenceType)) {
          await conn.execute(
            `INSERT INTO absences(student_id, absence_date, section, period_number, absence_type, created_by)
    VALUES(?, ?, ?, ?, ?, ?)`,
            [studentId, date, section, period, absenceType, created_by]
          );
        }
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    try {
      await conn.rollback();
    } catch { }
    console.error("Error saving absences:", e.message);
    res.status(500).json({ message: "خطأ في حفظ الغيابات", error: e.message });
  } finally {
    conn.release();
  }
};
