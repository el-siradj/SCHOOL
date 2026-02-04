const pool = require("../db");
const puppeteer = require("puppeteer");
const { logger } = require("../utils/logger");

const {
  normStr,
  normPhone,
  normStudentStatus,
  normGender,
  isActiveStatus,
} = require("../utils/helpers");

function buildStudentStatsFilter(query = {}) {
  const level = (query.level || "").trim();
  const className = (query.class || query.class_name || "").trim();
  const gender = (query.gender || "").trim().toUpperCase();
  const where = [];
  const params = [];

  if (level) {
    where.push("level = ?");
    params.push(level);
  }
  if (className) {
    where.push("class_name = ?");
    params.push(className);
  }
  if (gender && ["MALE", "FEMALE"].includes(gender)) {
    where.push("gender = ?");
    params.push(gender);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { whereSql, params, level, className, gender };
}

const STATUS_COLORS = {
  STUDYING: "#2563EB",
  INCOMING: "#0EA5E9",
  REFERRED: "#A855F7",
  ADDED: "#14B8A6",
  DELETED: "#EF4444",
  NOT_ENROLLED: "#64748B",
  LEFT: "#F97316",
  DROPPED: "#C026D3",
  UNSPECIFIED: "#94A3B8",
};
const GENDER_COLORS = {
  MALE: "#2563EB",
  FEMALE: "#ec4899",
  UNSPECIFIED: "#94A3B8",
};
const BAR_COLORS = ["#2563eb", "#22c55e", "#f97316", "#8b5cf6", "#f59e0b", "#0ea5e9", "#e11d48"];

async function gatherStudentStats(query = {}) {
  const { whereSql, params, level, className, gender } = buildStudentStatsFilter(query);
  const [[totalRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM students ${whereSql}`, params);
  const [statusRows] = await pool.execute(
    `SELECT status, COUNT(*) AS count FROM students ${whereSql} GROUP BY status`,
    params
  );
  const [genderRows] = await pool.execute(
    `SELECT gender, COUNT(*) AS count FROM students ${whereSql} GROUP BY gender`,
    params
  );
  const [levelRows] = await pool.execute(
    `SELECT level, COUNT(*) AS count FROM students ${whereSql} GROUP BY level ORDER BY count DESC LIMIT 12`,
    params
  );
  const [classRows] = await pool.execute(
    `SELECT class_name, COUNT(*) AS count FROM students ${whereSql} GROUP BY class_name ORDER BY count DESC LIMIT 12`,
    params
  );

  return {
    total: Number(totalRow?.total || 0),
    statusRows: statusRows.map((row) => ({
      status: row.status || "UNSPECIFIED",
      count: Number(row.count || 0),
    })),
    genderRows: genderRows.map((row) => ({
      gender: row.gender || "UNSPECIFIED",
      count: Number(row.count || 0),
    })),
    levelRows: levelRows.map((row) => ({
      level: row.level || "غير محدد",
      count: Number(row.count || 0),
    })),
    classRows: classRows.map((row) => ({
      class_name: row.class_name || "غير محدد",
      count: Number(row.count || 0),
    })),
    filters: { level, class: className, gender },
  };
}

function statusLabelArabic(status) {
  if (status === "STUDYING") return "متمدرس";
  if (status === "INCOMING") return "وافد";
  if (status === "REFERRED") return "مرجع";
  if (status === "ADDED") return "مضاف (مؤقت)";
  if (status === "DELETED") return "محذوف (مؤقت)";
  if (status === "NOT_ENROLLED") return "غير ملتحق";
  if (status === "LEFT") return "مغادر";
  if (status === "DROPPED") return "منقطع";
  return "غير محدد";
}

function genderLabelArabic(gender) {
  if (gender === "MALE") return "ذكر";
  if (gender === "FEMALE") return "أنثى";
  return "غير محدد";
}

function formatFiltersSummary(filters) {
  const parts = [];
  if (filters.level) parts.push(`المستوى: ${filters.level}`);
  if (filters.class) parts.push(`القسم: ${filters.class}`);
  if (filters.gender) parts.push(`الجنس: ${genderLabelArabic(filters.gender)}`);
  return parts.length ? parts.join("، ") : "بدون فلتر";
}

function buildStatsPdfHtml(stats, siteRow) {
  const headerName = siteRow?.site_name || "منظومة تدبير الغياب";
  const filtersText = formatFiltersSummary(stats.filters);
  const statusLegend = stats.statusRows
    .map(
      (row, index) => `
        <div class="legend-item">
          <span class="legend-dot" style="background:${STATUS_COLORS[row.status] || "#94A3B8"}"></span>
          <span>${statusLabelArabic(row.status)} (${row.count})</span>
        </div>`
    )
    .join("");
  const genderLegend = stats.genderRows
    .map(
      (row) => `
        <div class="legend-item">
          <span class="legend-dot" style="background:${GENDER_COLORS[row.gender] || "#94A3B8"}"></span>
          <span>${genderLabelArabic(row.gender)} (${row.count})</span>
        </div>`
    )
    .join("");
  const maxLevel = Math.max(1, ...stats.levelRows.map((row) => row.count), ...stats.classRows.map((row) => row.count));
  const levelBars = stats.levelRows
    .map(
      (row, index) => `
        <div class="bar-row">
          <div class="bar-row__label">${row.level}</div>
          <div class="bar-row__value">${row.count}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(row.count / maxLevel) * 100}%;background:${BAR_COLORS[index % BAR_COLORS.length]}"></div>
          </div>
        </div>`
    )
    .join("");
  const classBars = stats.classRows
    .map(
      (row, index) => `
        <div class="bar-row">
          <div class="bar-row__label">${row.class_name}</div>
          <div class="bar-row__value">${row.count}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(row.count / maxLevel) * 100}%;background:${BAR_COLORS[(index + 2) % BAR_COLORS.length]}"></div>
          </div>
        </div>`
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="ar">
      <head>
        <meta charset="utf-8" />
        <title>إحصائيات التلاميذ</title>
        <style>
          body { font-family: "Cairo", "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; direction: rtl; }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
          .title-block h1 { margin: 0; font-size: 24px; }
          .title-block p { margin: 4px 0 0; color: #475569; font-size: 12px; }
          .grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
          .card { background: #fff; border-radius: 16px; padding: 16px; box-shadow: 0 10px 20px rgba(15,23,42,0.08); border: 1px solid #e2e8f0; }
          .card h3 { margin: 0 0 12px; font-size: 14px; color: #475569; }
          .value { font-size: 32px; font-weight: 700; color: #0f172a; }
          .legend { display: flex; flex-direction: column; gap: 8px; }
          .legend-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #0f172a; }
          .legend-dot { width: 12px; height: 12px; border-radius: 999px; display: inline-block; }
          .bar-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
          .bar-row__label { font-size: 13px; color: #0f172a; }
          .bar-row__value { font-size: 12px; color: #475569; text-align: left; }
          .bar-track { width: 100%; height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
          .bar-fill { height: 100%; border-radius: 999px; }
          .filters { font-size: 12px; color: #475569; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title-block">
            <h1>إحصائيات التلاميذ</h1>
            <p>${headerName}</p>
            <p>الفلاتر: ${filtersText}</p>
          </div>
          <div class="value">${stats.total} تلميذ</div>
        </div>
        <div class="grid">
          <div class="card">
            <h3>حالة التلاميذ</h3>
            <div class="legend">${statusLegend || "<p class='text-xs text-gray-500'>لا توجد بيانات</p>"}</div>
          </div>
          <div class="card">
            <h3>الجنس</h3>
            <div class="legend">${genderLegend || "<p class='text-xs text-gray-500'>لا توجد بيانات</p>"}</div>
          </div>
          <div class="card">
            <h3>المستويات (أعلى 12)</h3>
            ${levelBars || "<p class='text-xs text-gray-500'>لا توجد بيانات</p>"}
          </div>
          <div class="card">
            <h3>الأقسام (أعلى 12)</h3>
            ${classBars || "<p class='text-xs text-gray-500'>لا توجد بيانات</p>"}
          </div>
        </div>
      </body>
    </html>
  `;
}

async function launchStatsPdfBrowser() {
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  };
  
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  try {
    return await puppeteer.launch(launchOptions);
  } catch (err) {
    console.error("[students/stats/pdf] puppeteer.launch failed:", err.message);
    // Try without custom args as fallback
    try {
      return await puppeteer.launch({ headless: true });
    } catch (err2) {
      console.error("[students/stats/pdf] puppeteer.launch fallback failed:", err2.message);
      throw new Error("فشل تشغيل Puppeteer. تأكد من تثبيت Chrome/Chromium.");
    }
  }
}

exports.getOne = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

  const [[row]] = await pool.execute(
    `SELECT id, class_number, massar_code, massar_password, full_name, status, gender,
            level, class_name, father_phone, mother_phone, guardian_phone
       FROM students
      WHERE id = ?`,
    [id]
  );

  if (!row) return res.status(404).json({ message: "التلميذ غير موجود" });

  res.json({ ...row, is_active: isActiveStatus(row.status) });
};

exports.list = async (req, res) => {
  const allParam = String(req.query.all || "").toLowerCase();
  const useAll = allParam === "true" || allParam === "1";

  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;

  const q = (req.query.q || "").trim();
  const level = (req.query.level || "").trim();
  const className = (req.query.class || req.query.class_name || "").trim();
  const status = (req.query.status || "").trim().toUpperCase();
  const gender = (req.query.gender || "").trim().toUpperCase();

  const where = [];
  const params = [];

  if (level) {
    where.push("level = ?");
    params.push(level);
  }
  if (className) {
    where.push("class_name = ?");
    params.push(className);
  }
  if (q) {
    where.push("(full_name LIKE ? OR massar_code LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    if (status === "ACTIVE") {
      where.push("status IN ('STUDYING','INCOMING','REFERRED','ADDED')");
    } else if (status === "INACTIVE") {
      where.push("status NOT IN ('STUDYING','INCOMING','REFERRED','ADDED')");
    } else if (["STUDYING", "INCOMING", "REFERRED", "ADDED", "DELETED", "NOT_ENROLLED", "LEFT", "DROPPED"].includes(status)) {
      where.push("status = ?");
      params.push(status);
    }
  }
  if (gender && ["MALE", "FEMALE"].includes(gender)) {
    where.push("gender = ?");
    params.push(gender);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM students ${whereSql}`, params);

  const total = Number(countRow.total || 0);
  const totalPages = useAll ? 1 : Math.max(1, Math.ceil(total / limit));

  const baseSelect = `SELECT id, class_number, massar_code, full_name, status, gender,
            level, class_name, father_phone, mother_phone, guardian_phone
       FROM students
      ${whereSql}
      ORDER BY class_name ASC, class_number IS NULL ASC, class_number ASC, full_name ASC, id ASC`;

  const [rows] = useAll
    ? await pool.execute(baseSelect, params)
    : await pool.execute(`${baseSelect} LIMIT ? OFFSET ?`, [...params, limit, offset]);

  // Options should come from the dedicated `classes` table (only active, ordered)
  const [levelsRows] = await pool.execute(
    `SELECT DISTINCT level FROM classes WHERE is_active=1 AND level<>'' ORDER BY level`
  );
  const [classesRows] = await pool.execute(
    `SELECT classe FROM classes WHERE is_active=1 ORDER BY \`order\` ASC, classe ASC`
  );

  res.json({
    data: rows.map((r) => ({ ...r, is_active: isActiveStatus(r.status) })),
    meta: { page: useAll ? 1 : page, limit: useAll ? total : limit, total, totalPages },
    options: {
      levels: levelsRows.map((x) => x.level).filter(Boolean),
      classes: classesRows.map((x) => x.classe).filter(Boolean),
      statuses: ["ACTIVE", "INACTIVE", "STUDYING", "INCOMING", "REFERRED", "ADDED", "DELETED", "NOT_ENROLLED", "LEFT", "DROPPED"],
      genders: ["MALE", "FEMALE"],
    },
  });
};

exports.stats = async (req, res) => {
  try {
    // support group=day to return cumulative daily counts for a month
    const group = (req.query.group || "").toString();
    if (group === "day") {
      const month = (req.query.month || "").toString();
      // expect month like YYYY-MM; default to current month
      const now = new Date();
      const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const targetMonth = /^\d{4}-\d{2}$/.test(month) ? month : defaultMonth;
      const startDate = `${targetMonth}-01`;

      // build additional filters (level, class, gender, status)
      const extraWhere = [];
      const extraParams = [];
      if (req.query.level) {
        extraWhere.push("s.level = ?");
        extraParams.push(req.query.level);
      }
      const className = (req.query.class || req.query.class_name || "").toString();
      if (className) {
        extraWhere.push("s.class_name = ?");
        extraParams.push(className);
      }
      if (req.query.gender) {
        extraWhere.push("s.gender = ?");
        extraParams.push(req.query.gender);
      }
      // status filter (if provided) - otherwise exclude explicit DELETED status
      const status = (req.query.status || "").toString().toUpperCase();
      if (status) {
        extraWhere.push("s.status = ?");
        extraParams.push(status);
      } else {
        extraWhere.push("s.status <> 'DELETED'");
      }

      const whereSql = extraWhere.length ? `AND ${extraWhere.join(" AND ")}` : "";

      // recursive CTE to generate days of month and compute cumulative count up to end of each day
      const sql = `WITH RECURSIVE days AS (
        SELECT ? AS d
        UNION ALL
        SELECT DATE_ADD(d, INTERVAL 1 DAY) FROM days WHERE d < LAST_DAY(?)
      )
      SELECT DATE_FORMAT(d, '%Y-%m-%d') AS day,
             (
               SELECT COUNT(*) FROM students s
               WHERE s.created_at < DATE_ADD(d, INTERVAL 1 DAY) ${whereSql}
             ) AS total
      FROM days
      ORDER BY day`;

      const params = [startDate, startDate, ...extraParams];
      const [rows] = await pool.execute(sql, params);
      const labels = rows.map((r) => (r.day ? r.day : ""));
      const data = rows.map((r) => Number(r.total || 0));
      return res.json({ labels, data, month: targetMonth });
    }

    const stats = await gatherStudentStats(req.query);
    res.json({
      total: stats.total,
      byStatus: stats.statusRows,
      byGender: stats.genderRows,
      byLevel: stats.levelRows,
      byClass: stats.classRows,
      filters: stats.filters,
    });
  } catch (e) {
    res.status(500).json({ message: "فشل تحميل إحصائيات التلاميذ", error: e.message });
  }
};

exports.statsPdf = async (req, res) => {
  let browser;
  try {
    const stats = await gatherStudentStats(req.query);
    const [[siteRow]] = await pool.execute("SELECT site_name, site_logo_url FROM settings WHERE id=1");
    browser = await launchStatsPdfBrowser();
    const page = await browser.newPage();
    await page.setContent(buildStatsPdfHtml(stats, siteRow), { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=student-stats.pdf");
    res.send(pdfBuffer);
  } catch (e) {
    res.status(500).json({ message: "فشل توليد ملف PDF", error: e.message });
  } finally {
    if (browser) await browser.close();
  }
};

exports.create = async (req, res) => {
  try {
    const class_number = req.body?.class_number ? Number(req.body.class_number) : null;
    const massar_code = normStr(req.body?.massar_code);
    const massar_password = normStr(req.body?.massar_password);
    const full_name = normStr(req.body?.full_name);
    const level = normStr(req.body?.level);
    const class_name = normStr(req.body?.class_name);

    const status = normStudentStatus(req.body?.status, "STUDYING");
    const gender = normGender(req.body?.gender);

    const father_phone = normPhone(req.body?.father_phone);
    const mother_phone = normPhone(req.body?.mother_phone);
    const guardian_phone = normPhone(req.body?.guardian_phone);

    if (!massar_code || !full_name || !level || !class_name) {
      return res.status(400).json({ message: "رقم مسار والاسم والمستوى والقسم مطلوبة" });
    }

    const [r] = await pool.execute(
      `INSERT INTO students
       (class_number, massar_code, massar_password, full_name, status, gender, level, class_name, father_phone, mother_phone, guardian_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        class_number,
        massar_code,
        massar_password,
        full_name,
        status,
        gender,
        level,
        class_name,
        father_phone,
        mother_phone,
        guardian_phone,
      ]
    );

    logger.info("Student created", {
      studentId: r.insertId,
      massar_code,
      full_name,
      level,
      class_name,
      userId: req.user?.id,
    });

    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    if (String(e.code) === "ER_DUP_ENTRY") {
      logger.warn("Duplicate student massar code", {
        massar_code: req.body?.massar_code,
        userId: req.user?.id,
      });
      return res.status(409).json({ message: "رقم مسار موجود بالفعل" });
    }
    logger.error("Failed to create student", e, { userId: req.user?.id, data: req.body });
    res.status(500).json({ message: "فشل إنشاء التلميذ", error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

    const class_number = req.body?.class_number ? Number(req.body.class_number) : null;
    const massar_code = normStr(req.body?.massar_code);
    const massar_password = normStr(req.body?.massar_password);
    const full_name = normStr(req.body?.full_name);
    const level = normStr(req.body?.level);
    const class_name = normStr(req.body?.class_name);

    const status = normStudentStatus(req.body?.status, "STUDYING");
    const gender = normGender(req.body?.gender);

    const father_phone = normPhone(req.body?.father_phone);
    const mother_phone = normPhone(req.body?.mother_phone);
    const guardian_phone = normPhone(req.body?.guardian_phone);

    if (!massar_code || !full_name || !level || !class_name) {
      return res.status(400).json({ message: "رقم مسار والاسم والمستوى والقسم مطلوبة" });
    }

    await pool.execute(
      `UPDATE students
       SET class_number=?, massar_code=?, massar_password=?, full_name=?, status=?, gender=?,
           level=?, class_name=?, father_phone=?, mother_phone=?, guardian_phone=?
       WHERE id=?`,
      [
        class_number,
        massar_code,
        massar_password,
        full_name,
        status,
        gender,
        level,
        class_name,
        father_phone,
        mother_phone,
        guardian_phone,
        id,
      ]
    );

    logger.info("Student updated", {
      studentId: id,
      massar_code,
      full_name,
      userId: req.user?.id,
    });

    res.json({ ok: true });
  } catch (e) {
    if (String(e.code) === "ER_DUP_ENTRY") {
      logger.warn("Duplicate student massar code on update", {
        studentId: req.params.id,
        massar_code: req.body?.massar_code,
        userId: req.user?.id,
      });
      return res.status(409).json({ message: "رقم مسار موجود بالفعل" });
    }
    logger.error("Failed to update student", e, { studentId: req.params.id, userId: req.user?.id });
    res.status(500).json({ message: "فشل تحديث التلميذ", error: e.message });
  }
};

// Soft delete: change status instead of removing the row.
exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

    const requested = req.query.status || req.body?.status || null;
    const nextStatus = normStudentStatus(requested, "LEFT");

    if (["STUDYING", "INCOMING", "REFERRED", "ADDED", "ACTIVE", "INACTIVE"].includes(nextStatus)) {
      return res.status(400).json({ message: "لا يمكن اختيار حالة نشطة في هذا الإجراء" });
    }

    const [r] = await pool.execute(`UPDATE students SET status=? WHERE id=?`, [nextStatus, id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: "التلميذ غير موجود" });

    logger.info("Student status changed (soft delete)", {
      studentId: id,
      newStatus: nextStatus,
      userId: req.user?.id,
    });

    res.json({ ok: true, status: nextStatus });
  } catch (e) {
    logger.error("Failed to change student status", e, { studentId: req.params.id, userId: req.user?.id });
    res.status(500).json({ message: "فشل تغيير حالة التلميذ", error: e.message });
  }
};
