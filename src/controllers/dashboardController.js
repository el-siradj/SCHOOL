const pool = require("../db");

function pickDays(n = 7) {
  const days = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push(key);
  }
  return days;
}

exports.overview = async (req, res) => {
  try {
    const [[studentsRow]] = await pool.execute("SELECT COUNT(*) AS total FROM students");
    const [[activeStudentsRow]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM students WHERE status = 'STUDYING'"
    );
    const [[teachersRow]] = await pool.execute("SELECT COUNT(*) AS total FROM teachers");

    const [studentStatusRows] = await pool.execute(
      "SELECT status, COUNT(*) AS cnt FROM students GROUP BY status"
    );
    const studentsByStatus = Object.fromEntries(
      (studentStatusRows || []).map((r) => [String(r.status || "UNKNOWN"), Number(r.cnt || 0)])
    );

    const [studentGenderRows] = await pool.execute(
      "SELECT gender, COUNT(*) AS cnt FROM students GROUP BY gender"
    );
    const studentsByGender = Object.fromEntries(
      (studentGenderRows || []).map((r) => [String(r.gender || "UNKNOWN"), Number(r.cnt || 0)])
    );

    const [teacherGenderRows] = await pool.execute(
      "SELECT gender, COUNT(*) AS cnt FROM teachers GROUP BY gender"
    );
    const teachersByGender = Object.fromEntries(
      (teacherGenderRows || []).map((r) => [String(r.gender || "UNKNOWN"), Number(r.cnt || 0)])
    );

    const [campRows] = await pool.execute(
      "SELECT status, COUNT(*) AS cnt FROM campaigns GROUP BY status"
    );
    const campaignsByStatus = Object.fromEntries(
      (campRows || []).map((r) => [r.status, Number(r.cnt || 0)])
    );

    const [msgRows] = await pool.execute(
      "SELECT status, COUNT(*) AS cnt FROM message_logs GROUP BY status"
    );
    const messagesByStatus = Object.fromEntries(
      (msgRows || []).map((r) => [r.status, Number(r.cnt || 0)])
    );

    const days = pickDays(7);
    const [tsRows] = await pool.execute(
      `SELECT DATE(sent_at) AS day,
              SUM(status='SENT') AS sent,
              SUM(status='FAILED') AS failed,
              SUM(status='SKIPPED') AS skipped
         FROM message_logs
        WHERE sent_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        GROUP BY DATE(sent_at)
        ORDER BY day ASC`
    );
    const map = new Map(
      (tsRows || []).map((r) => [
        String(r.day),
        {
          date: String(r.day),
          sent: Number(r.sent || 0),
          failed: Number(r.failed || 0),
          skipped: Number(r.skipped || 0),
        },
      ])
    );
    const last7Days = days.map((d) => map.get(d) || { date: d, sent: 0, failed: 0, skipped: 0 });

    const campaignsTotal = Object.values(campaignsByStatus).reduce((a, b) => a + b, 0);
    const messagesTotal = Object.values(messagesByStatus).reduce((a, b) => a + b, 0);

    const inactiveByStatus = stableInactiveStatusMap(studentsByStatus);

    res.json({
      students: {
        total: Number(studentsRow?.total || 0),
        active_total: Number(activeStudentsRow?.total || 0),
        by_status: studentsByStatus,
        inactive_by_status: inactiveByStatus,
        by_gender: studentsByGender,
      },
      teachers: { total: Number(teachersRow?.total || 0), by_gender: teachersByGender },
      campaigns: { total: campaignsTotal, by_status: campaignsByStatus },
      messages: { total: messagesTotal, by_status: messagesByStatus },
      last7Days,
    });
  } catch (e) {
    res.status(500).json({ message: "فشل جلب إحصائيات لوحة القيادة", error: e.message });
  }
};

function stableInactiveStatusMap(byStatus) {
  const inactiveByStatus = {};
  for (const [k, v] of Object.entries(byStatus || {})) {
    const key = String(k || "UNKNOWN");
    if (!key) continue;
    if (["STUDYING", "INCOMING", "REFERRED", "ADDED"].includes(key)) continue;
    inactiveByStatus[key] = Number(v || 0);
  }
  for (const k of ["DELETED", "NOT_ENROLLED", "LEFT", "DROPPED"]) {
    if (!Object.prototype.hasOwnProperty.call(inactiveByStatus, k)) inactiveByStatus[k] = 0;
  }
  return inactiveByStatus;
}

exports.studentMobility = async (req, res) => {
  try {
    const level = String(req.query.level || "").trim();

    const [levelsRows] = await pool.execute(
      "SELECT DISTINCT level FROM students WHERE level IS NOT NULL AND level <> '' ORDER BY level"
    );
    const levels = (levelsRows || []).map((r) => String(r.level)).filter(Boolean);

    const where = [];
    const params = [];
    if (level) {
      where.push("level = ?");
      params.push(level);
    }
    // Mobility: show all statuses except STUDYING (متمدرس)
    where.push("status <> 'STUDYING'");

    const [rows] = await pool.execute(
      `SELECT status, COUNT(*) AS cnt
         FROM students
        WHERE ${where.join(" AND ")}
        GROUP BY status`,
      params
    );
    const byStatus = Object.fromEntries(
      (rows || []).map((r) => [String(r.status || "UNKNOWN"), Number(r.cnt || 0)])
    );

    const total = Object.values(byStatus).reduce((a, b) => a + Number(b || 0), 0);

    res.json({
      level: level || null,
      levels,
      by_status: byStatus,
      // Backward-compat for older frontend builds
      inactive_by_status: byStatus,
      total,
    });
  } catch (e) {
    res.status(500).json({ message: "Error loading student mobility stats", error: e.message });
  }
};

exports.absenceRateLast7 = async (req, res) => {
  try {
    const level = String(req.query.level || "").trim();
    const className = String(req.query.class || req.query.class_name || "").trim();

    const whereStudents = ["status IN ('STUDYING','INCOMING','REFERRED','ADDED')"];
    const paramsStudents = [];
    if (level) {
      whereStudents.push("level = ?");
      paramsStudents.push(level);
    }
    if (className) {
      whereStudents.push("class_name = ?");
      paramsStudents.push(className);
    }

    const [[totalRow]] = await pool.execute(
      `SELECT COUNT(*) AS total
         FROM students
        WHERE ${whereStudents.join(" AND ")}`,
      paramsStudents
    );
    const totalStudents = Number(totalRow?.total || 0);

    const days = pickDays(7);
    const start = days[0];
    const end = days[days.length - 1];

    const whereAbs = [
      "a.absence_date BETWEEN ? AND ?",
      "s.status IN ('STUDYING','INCOMING','REFERRED','ADDED')",
    ];
    const paramsAbs = [start, end];
    if (level) {
      whereAbs.push("s.level = ?");
      paramsAbs.push(level);
    }
    if (className) {
      whereAbs.push("s.class_name = ?");
      paramsAbs.push(className);
    }

    const [rows] = await pool.execute(
      `SELECT DATE_FORMAT(a.absence_date, '%Y-%m-%d') AS day,
              COUNT(DISTINCT a.student_id) AS absent
         FROM absences a
         JOIN students s ON s.id = a.student_id
        WHERE ${whereAbs.join(" AND ")}
        GROUP BY day
        ORDER BY day ASC`,
      paramsAbs
    );

    const map = new Map(
      (rows || []).map((r) => [
        String(r.day),
        { date: String(r.day), absent: Number(r.absent || 0) },
      ])
    );

    const out = days.map((d) => {
      const row = map.get(d) || { date: d, absent: 0 };
      const rate = totalStudents > 0 ? (row.absent / totalStudents) * 100 : 0;
      return { ...row, total_students: totalStudents, rate };
    });

    res.json({
      filters: { level: level || null, class_name: className || null },
      total_students: totalStudents,
      days: out,
    });
  } catch (e) {
    res.status(500).json({ message: "Error loading absence rate", error: e.message });
  }
};
