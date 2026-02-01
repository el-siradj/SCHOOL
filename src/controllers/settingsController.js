const pool = require("../db");
const path = require("path");

function toHHMM(value) {
  if (!value) return "";
  const s = String(value);
  const m = s.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

const MAX_TIMETABLE_DAYS = 7;

function parseBool(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function mapTimetableDay(row, index = 0) {
  return {
    id: Number(row?.id || 0),
    code: row?.code || `DAY${index + 1}`,
    label_ar: row?.label_ar || "",
    is_active: Boolean(row?.Is_active ?? row?.is_active ?? true),
    order: Number(row?.Order ?? row?.order ?? index),
  };
}

function mapTimetablePeriod(row, index = 0) {
  return {
    id: Number(row?.id || 0),
    code: row?.code || `P${index + 1}`,
    start_time: toHHMM(row?.start_time),
    end_time: toHHMM(row?.end_time),
    is_active: Boolean(row?.Is_active ?? row?.is_active ?? true),
    order: Number(row?.order ?? row?.Order ?? index),
  };
}


function mapClassRow(row, index = 0) {
  const classeName = row?.classe ?? row?.section ?? "";
  return {
    id: Number(row?.id || 0),
    level: row?.level || "",
    classe: classeName,
    section: classeName,
    cycle: row?.cycle || null,
    is_active: Boolean(row?.is_active ?? row?.Is_active ?? true),
    order: Number(row?.order ?? row?.Order ?? index),
  };
}

function sanitizeClassInput(input, fallbackOrder = 0) {
  const level = typeof input?.level === "string" ? input.level.trim().slice(0, 60) : "";
  const classeValue =
    typeof input?.classe === "string"
      ? input.classe.trim().slice(0, 60)
      : typeof input?.section === "string"
      ? input.section.trim().slice(0, 60)
      : "";
  const order = Number.isFinite(Number(input?.order)) ? Number(input.order) : Number(fallbackOrder || 0);
  return {
    level: level || classeValue || "Class",
    classe: classeValue || level || "Classe",
    section: classeValue || level || "Section",
    cycle: typeof input?.cycle === "string" ? input.cycle.trim() : null,
    is_active: parseBool(input?.is_active),
    order,
  };
}

async function loadTimetableClasses() {
  const [rows] = await pool.execute("SELECT id, level, classe, cycle, is_active, `order` FROM classes ORDER BY `order` ASC");
  return (rows || []).map((row, index) => mapClassRow(row, index));
}

async function getActivePeriodsCount() {
  const [[row]] = await pool.execute("SELECT COUNT(*) AS total FROM timetable_periods WHERE Is_active=1");
  return Math.max(1, Number(row?.total || 8));
}

function cellEnabledFromAny(cell) {
  if (cell == null) return false;
  if (typeof cell === "boolean") return cell;
  if (typeof cell === "number") return cell === 1;
  if (typeof cell === "string") {
    const s = cell.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  if (typeof cell === "object") {
    const start = toHHMM(cell.start);
    const end = toHHMM(cell.end);
    return Boolean(start && end);
  }
  return false;
}

function normalizeWeeklySchedule(input, periodsCount) {
  if (input == null) return null;
  if (typeof input !== "object") return null;

  const days = input.days && typeof input.days === "object" ? input.days : input;
  const out = { version: 1, days: {} };

  for (let jsDay = 1; jsDay <= 6; jsDay++) {
    const key = String(jsDay);
    const dayIn = days?.[key] || days?.[jsDay] || {};
    const enabled = Boolean(dayIn.enabled);

    const periodsIn =
      dayIn.periods && typeof dayIn.periods === "object" ? dayIn.periods : {};

    const periodsOut = {};
    for (let p = 1; p <= 8; p++) {
      const cell = periodsIn[String(p)] ?? periodsIn[p];
      periodsOut[String(p)] = cellEnabledFromAny(cell);
    }

    out.days[key] = { enabled, periods: periodsOut };
  }

  out.periods_count = Math.max(1, Math.min(8, Number(periodsCount || 8)));
  return out;
}

function parseWeeklySchedule(json, periodsCount) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(String(json));
    return normalizeWeeklySchedule(parsed, periodsCount);
  } catch {
    return null;
  }
}

function normalizeTimeField(value) {
  const time = toHHMM(value);
  return time || null;
}

function sanitizeDayInput(input, fallbackOrder = 0) {
  const code = typeof input?.code === "string" ? input.code.trim().slice(0, 10) : "";
  const label = typeof input?.label_ar === "string" ? input.label_ar.trim().slice(0, 30) : "";
  const order = Number.isFinite(Number(input?.order)) ? Number(input.order) : Number(fallbackOrder || 0);
  return {
    code: code || (label ? label.replace(/\s+/g, "_").slice(0, 10) : `DAY${Date.now()}`),
    label_ar: label || code || `ÙÙÙ ${order || 1}`,
    is_active: parseBool(input?.is_active),
    order,
  };
}

function sanitizePeriodInput(input, fallbackOrder = 0) {
  const code = typeof input?.code === "string" ? input.code.trim().slice(0, 10) : "";
  const order = Number.isFinite(Number(input?.order)) ? Number(input.order) : Number(fallbackOrder || 0);
  return {
    code: code || `P${order || Date.now()}`,
    start_time: normalizeTimeField(input?.start_time),
    end_time: normalizeTimeField(input?.end_time),
    is_active: parseBool(input?.is_active),
    order,
  };
}

async function loadTimetableDefinitions() {
  const [daysRows] = await pool.execute(
    "SELECT id, code, label_ar, Is_active, `Order` FROM timetable_days ORDER BY `Order` ASC"
  );
  const [periodRows] = await pool.execute(
    "SELECT id, code, start_time, end_time, Is_active, `order` FROM timetable_periods ORDER BY `order` ASC"
  );

  const days = (daysRows || []).map((row, index) => mapTimetableDay(row, index));
  const periods = (periodRows || []).map((row, index) => mapTimetablePeriod(row, index));

  const classes = await loadTimetableClasses();
  return { days, periods, classes };
}

function mapStudyPeriodRow(row) {
  return {
    day_id: Number(row?.day_id || 0),
    period_id: Number(row?.period_id || 0),
    cycle: row?.cycle || "",
    is_active: Boolean(row?.is_active ?? row?.Is_active ?? true),
  };
}

async function loadStudyPeriods() {
  const [rows] = await pool.execute(
    "SELECT day_id, period_id, cycle, is_active FROM timetable_study_periods"
  );
  return (rows || []).map((row) => mapStudyPeriodRow(row));
}

function sanitizeStudyPeriodInput(input) {
  if (!input || typeof input !== "object") return null;
  const dayId = Number(input.day_id);
  const periodId = Number(input.period_id);
  if (!Number.isFinite(dayId) || dayId <= 0 || !Number.isFinite(periodId) || periodId <= 0) {
    return null;
  }
  const cycleValue =
    typeof input.cycle === "string"
      ? input.cycle.trim().slice(0, 16)
      : typeof input?.cycle === "number"
      ? String(input.cycle)
      : "";
  if (!cycleValue) return null;

  return {
    day_id: dayId,
    period_id: periodId,
    cycle: cycleValue,
    is_active: parseBool(input.is_active),
  };
}

function getJsDayFromYMD(dateStr) {
  const parts = String(dateStr || "").split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  // Use UTC to avoid timezone issues. JS days are 0=Sun, 1=Mon...
  const dt = new Date(Date.UTC(y, m - 1, d));
  const jsDay = dt.getUTCDay();
  return Number.isFinite(jsDay) ? jsDay : null;
}

exports.getDayStatus = async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) {
      return res.status(400).json({ message: "Date parameter is required" });
    }

    const jsDay = getJsDayFromYMD(date);
    if (jsDay === null) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    // Human readable (Arabic) day name based on the provided date
    // Note: toLocaleDateString uses server locale/ICU; fallback to mapping if it fails.
    let day_name = null;
    try {
      day_name = new Date(`${date}T00:00:00`).toLocaleDateString("ar-MA", { weekday: "long" });
    } catch (_) {
      const map = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
      day_name = map[jsDay] || null;
    }

    if (jsDay === 0) {
      // Sunday
      return res.json({ date, day_order: 0, day_name, is_active: false });
    }

    const dayOrder = jsDay;

    const [rows] = await pool.execute(
      "SELECT Is_active FROM timetable_days WHERE `Order` = ? LIMIT 1",
      [dayOrder]
    );

    if (!rows.length) {
      return res.json({ date, day_order: dayOrder, day_name, is_active: false });
    }

    res.json({ date, day_order: dayOrder, day_name, is_active: !!rows[0].Is_active });
  } catch (e) {
    res.status(500).json({ message: "Error checking day status", error: e.message });
  }
};

exports.getStudyPeriodsStatus = async (req, res) => {
  try {
    const date = req.query.date;
    const cycle = req.query.cycle;
    if (!date || !cycle) {
      return res.status(400).json({ message: "date and cycle parameters are required" });
    }

    const jsDay = getJsDayFromYMD(date);
    if (jsDay === null) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const [dayRows] = await pool.execute(
      "SELECT id, label_ar, Is_active, `Order` FROM timetable_days WHERE `Order` = ? LIMIT 1",
      [jsDay]
    );
    const dayRow = dayRows && dayRows[0] ? dayRows[0] : null;

    const day_id = dayRow ? Number(dayRow.id) : null;
    const day_name = dayRow ? dayRow.label_ar : null;
    const day_active = dayRow ? !!dayRow.Is_active : false;

    if (!day_id) {
      return res.json({
        date,
        cycle,
        day_order: jsDay,
        day_id: null,
        day_name,
        day_active: false,
        has_config: false,
        periods: [],
      });
    }

    if (!day_active) {
      return res.json({
        date,
        cycle,
        day_order: jsDay,
        day_id,
        day_name,
        day_active: false,
        has_config: false,
        periods: [],
      });
    }

    const [rows] = await pool.execute(
      "SELECT period_id, is_active FROM timetable_study_periods WHERE cycle = ? AND day_id = ?",
      [cycle, day_id]
    );

    const periods = (rows || []).map((r) => ({
      period_id: Number(r.period_id),
      is_active: !!r.is_active,
    }));

    res.json({
      date,
      cycle,
      day_order: jsDay,
      day_id,
      day_name,
      day_active: true,
      has_config: periods.length > 0,
      periods,
    });
  } catch (e) {
    res.status(500).json({ message: "Error loading study periods status", error: e.message });
  }
};


exports.public = async (req, res) => {
  const [[row]] = await pool.execute(
    "SELECT site_name, site_logo_url FROM settings WHERE id=1"
  );

  const timetable = await loadTimetableDefinitions();
  const periodsCount = await getActivePeriodsCount();

  res.json({
    site_name:
      row?.site_name ||
      "المدرسة الرقمية 2",
    site_logo_url: row?.site_logo_url || null,
    periods_count: periodsCount,
    timetable_days: timetable.days,
    timetable_periods: timetable.periods,
    timetable_classes: timetable.classes,
  });
};

exports.get = async (req, res) => {
  const [[row]] = await pool.execute(
    "SELECT site_name, site_logo_url, send_delay_ms, max_per_batch, work_hours_start, work_hours_end FROM settings WHERE id=1"
  );

  const data =
    row || {
      site_name:
        "المدرسة الرقمية 2",
      site_logo_url: null,
      send_delay_ms: 4000,
      max_per_batch: 300,
      work_hours_start: null,
      work_hours_end: null,

    };

  const timetable = await loadTimetableDefinitions();
  const periodsCount = await getActivePeriodsCount();

  data.periods_count = periodsCount;
  data.timetable_days = timetable.days;
  data.timetable_periods = timetable.periods;
  data.timetable_classes = timetable.classes;
  res.json(data);
};

exports.update = async (req, res) => {
  const {
    site_name,
    site_logo_url,
    send_delay_ms,
    max_per_batch,
    work_hours_start,
    work_hours_end,

  } = req.body || {};

  const delay = Math.max(1000, Math.min(30000, Number(send_delay_ms || 4000)));
  const maxBatch = Math.max(50, Math.min(5000, Number(max_per_batch || 300)));

  const cleanName =
    typeof site_name === "string" && site_name.trim()
      ? site_name.trim().slice(0, 120)
      : "المدرسة الرقمية 2";

  const cleanLogo =
    typeof site_logo_url === "string" && site_logo_url.trim()
      ? site_logo_url.trim().slice(0, 255)
      : null;

  await pool.execute(
    `UPDATE settings
     SET site_name=?, site_logo_url=?, send_delay_ms=?, max_per_batch=?, work_hours_start=?, work_hours_end=?
     WHERE id=1`,
    [
      cleanName,
      cleanLogo,
      delay,
      maxBatch,
      work_hours_start || null,
      work_hours_end || null,

    ]
  );

  res.json({ ok: true });
};

exports.updateLogo = async (req, res) => {
  try {
    if (!req.file?.path)
      return res.status(400).json({ message: "Ä¯?Ä?Ä?Ä?Ä? Ä?Ä¯ÅÄ?Ä?Ä¯?" });
    const abs = String(req.file.path).replace(/\\/g, "/");
    const filename = path.basename(abs);
    const url = `/uploads/${filename}`;
    const uploadsBase = process.env.UPLOADS_BASE_URL || process.env.APP_BASE_URL || null;
    const cleanBase = uploadsBase ? String(uploadsBase).replace(/\/$/, "") : null;
    const absolute_url = cleanBase ? `${cleanBase}${url}` : null;

    await pool.execute("UPDATE settings SET site_logo_url=? WHERE id=1", [url]);
    res.json({ ok: true, site_logo_url: url, site_logo_absolute_url: absolute_url || undefined });
  } catch (e) {
    res.status(500).json({
      message: "Ä?Ä¯?Ä? Ä¯?Ä¯?Ä¯?Ä?Ä¯Â® Ä¯?Ä?Ä¯?Ä¯?Ä¯?Ä¯?",
      error: e.message,
    });
  }
};
async function countTimetableDays() {
  const [[row]] = await pool.execute("SELECT COUNT(*) AS total FROM timetable_days");
  return Number(row?.total || 0);
}

async function getTimetableDayById(id) {
  if (!Number.isFinite(Number(id))) return null;
  const [rows] = await pool.execute(
    "SELECT id, code, label_ar, Is_active, `Order` FROM timetable_days WHERE id=?",
    [id]
  );
  if (!rows || !rows.length) return null;
  return mapTimetableDay(rows[0]);
}

async function getTimetablePeriodById(id) {
  if (!Number.isFinite(Number(id))) return null;
  const [rows] = await pool.execute(
    "SELECT id, code, start_time, end_time, Is_active, `order` FROM timetable_periods WHERE id=?",
    [id]
  );
  if (!rows || !rows.length) return null;
  return mapTimetablePeriod(rows[0]);
}

async function getMaxPeriodOrder() {
  const [[row]] = await pool.execute("SELECT MAX(`order`) AS maxOrder FROM timetable_periods");
  return Number.isFinite(Number(row?.maxOrder)) ? Number(row.maxOrder) : 0;
}

exports.listTimetableDays = async (req, res) => {
  try {
    const timetable = await loadTimetableDefinitions();
    res.json({ data: timetable.days });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÊÍãíá ÇáÃíÇã", error: e.message });
  }
};

exports.createTimetableDay = async (req, res) => {
  try {
    const total = await countTimetableDays();
    if (total >= MAX_TIMETABLE_DAYS) {
      return res.status(400).json({ message: "ÇáÍÏ ÇáÃÞÕì åæ 7 ÃíÇã" });
    }
    const fallbackOrder = total + 1;
    const sanitized = sanitizeDayInput(req.body || {}, fallbackOrder);

    const [result] = await pool.execute(
      "INSERT INTO timetable_days (code, label_ar, Is_active, `Order`) VALUES (?, ?, ?, ?)",
      [sanitized.code, sanitized.label_ar, sanitized.is_active ? 1 : 0, sanitized.order]
    );

    const day = await getTimetableDayById(result.insertId);
    res.status(201).json({ ok: true, day });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÅäÔÇÁ Çáíæã", error: e.message });
  }
};

exports.updateTimetableDay = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ãÚÑÝ ÛíÑ ÕÇáÍ" });
    const existing = await getTimetableDayById(id);
    if (!existing) return res.status(404).json({ message: "Çáíæã ÛíÑ ãæÌæÏ" });

    const merged = { ...existing, ...req.body };
    const sanitized = sanitizeDayInput(merged, existing.order || 0);

    await pool.execute(
      "UPDATE timetable_days SET code=?, label_ar=?, Is_active=?, `Order`=? WHERE id=?",
      [sanitized.code, sanitized.label_ar, sanitized.is_active ? 1 : 0, sanitized.order, id]
    );

    const day = await getTimetableDayById(id);
    res.json({ ok: true, day });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÊÚÏíá Çáíæã", error: e.message });
  }
};

exports.deleteTimetableDay = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ãÚÑÝ ÛíÑ ÕÇáÍ" });
    const [result] = await pool.execute("DELETE FROM timetable_days WHERE id=?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Çáíæã ÛíÑ ãæÌæÏ" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÍÐÝ Çáíæã", error: e.message });
  }
};

exports.listTimetablePeriods = async (req, res) => {
  try {
    const timetable = await loadTimetableDefinitions();
    res.json({ data: timetable.periods });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÊÍãíá ÇáÍÕÕ", error: e.message });
  }
};

exports.createTimetablePeriod = async (req, res) => {
  try {
    const fallbackOrder = (await getMaxPeriodOrder()) + 1;
    const sanitized = sanitizePeriodInput(req.body || {}, fallbackOrder);

    const [result] = await pool.execute(
      "INSERT INTO timetable_periods (code, start_time, end_time, Is_active, `order`) VALUES (?, ?, ?, ?, ?)",
      [sanitized.code, sanitized.start_time, sanitized.end_time, sanitized.is_active ? 1 : 0, sanitized.order]
    );

    const period = await getTimetablePeriodById(result.insertId);
    res.status(201).json({ ok: true, period });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÅäÔÇÁ ÇáÍÕÉ", error: e.message });
  }
};

exports.updateTimetablePeriod = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ãÚÑÝ ÛíÑ ÕÇáÍ" });
    const existing = await getTimetablePeriodById(id);
    if (!existing) return res.status(404).json({ message: "ÇáÍÕÉ ÛíÑ ãæÌæÏÉ" });

    const merged = { ...existing, ...req.body };
    const sanitized = sanitizePeriodInput(merged, existing.order || 0);

    await pool.execute(
      "UPDATE timetable_periods SET code=?, start_time=?, end_time=?, Is_active=?, `order`=? WHERE id=?",
      [sanitized.code, sanitized.start_time, sanitized.end_time, sanitized.is_active ? 1 : 0, sanitized.order, id]
    );

    const period = await getTimetablePeriodById(id);
    res.json({ ok: true, period });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÊÚÏíá ÇáÍÕÉ", error: e.message });
  }
};

exports.deleteTimetablePeriod = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ãÚÑÝ ÛíÑ ÕÇáÍ" });
    const [result] = await pool.execute("DELETE FROM timetable_periods WHERE id=?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "ÇáÍÕÉ ÛíÑ ãæÌæÏÉ" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÍÐÝ ÇáÍÕÉ", error: e.message });
  }
};

async function getClassById(id) {
  if (!Number.isFinite(Number(id))) return null;
  const [rows] = await pool.execute("SELECT id, level, classe, cycle, is_active, `order` FROM classes WHERE id=?", [id]);
  if (!rows || !rows.length) return null;
  return mapClassRow(rows[0]);
}

async function getClassByLevelClasse(level, classeValue) {
  if (!level || !classeValue) return null;
  const [rows] = await pool.execute("SELECT id, level, classe, cycle, is_active, `order` FROM classes WHERE level=? AND classe=?", [level, classeValue]);
  if (!rows || !rows.length) return null;
  return mapClassRow(rows[0]);
}

async function getMaxClassOrder() {
  const [[row]] = await pool.execute("SELECT MAX(`order`) AS maxOrder FROM classes");
  return Number.isFinite(Number(row?.maxOrder)) ? Number(row.maxOrder) : 0;
}

exports.listTimetableClasses = async (req, res) => {
  try {
    const classes = await loadTimetableClasses();
    res.json({ data: classes });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÊÍãíá ÇáÃÞÓÇã", error: e.message });
  }
};

// Operational endpoint (Absences, etc.): active classes only, ordered.
// Returns: [{ id, level, classe, cycle, is_active, order }]
exports.listActiveTimetableClasses = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, level, classe, cycle, is_active, `order` FROM classes WHERE is_active=1 ORDER BY `order` ASC, id ASC"
    );
    res.json({
      data: (rows || []).map((r) => mapClassRow(r)),
    });
  } catch (e) {
    res.status(500).json({ message: "فشل تحميل الأقسام", error: e.message });
  }
};

exports.createTimetableClass = async (req, res) => {
  try {
    const sanitized = sanitizeClassInput(req.body || {}, (await getMaxClassOrder()) + 1);
    const normalizedLevel = sanitized.level.trim();
    const normalizedClasse = sanitized.classe.trim();
    if (!normalizedLevel || !normalizedClasse) {
      return res.status(400).json({ message: "íÑÌì ÊÍÏíÏ ÇáãÓÊæì æÇáÞÓã" });
    }

    const existing = await getClassByLevelClasse(normalizedLevel, normalizedClasse);
    if (existing) {
      return res.status(400).json({ message: "åÐÇ ÇáãÓÊæì æÇáÞÓã ãæÌæÏÇä ãÓÈÞðÇ" });
    }

    await pool.execute("INSERT INTO classes (level, classe, cycle, is_active, `order`) VALUES (?, ?, ?, ?, ?)", [
      normalizedLevel,
      normalizedClasse,
      sanitized.cycle || null,
      sanitized.is_active ? 1 : 0,
      sanitized.order,
    ]);

    const classes = await loadTimetableClasses();
    res.status(201).json({ ok: true, data: classes });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÅäÔÇÁ ÇáÞÓã", error: e.message });
  }
};

exports.updateTimetableClass = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ãÚÑÝ ÛíÑ ÕÇáÍ" });
    const existing = await getClassById(id);
    if (!existing) return res.status(404).json({ message: "ÇáÞÓã ÛíÑ ãæÌæÏ" });

    const sanitized = sanitizeClassInput({ ...existing, ...req.body }, existing.order);

    await pool.execute("UPDATE classes SET cycle=?, is_active=?, `order`=? WHERE id=?", [
      sanitized.cycle || null,
      sanitized.is_active ? 1 : 0,
      sanitized.order,
      id,
    ]);

    const updated = await getClassById(id);
    res.json({ ok: true, data: updated });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÊÚÏíá ÇáÞÓã", error: e.message });
  }
};

exports.deleteTimetableClass = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ãÚÑÝ ÛíÑ ÕÇáÍ" });
    const [result] = await pool.execute("DELETE FROM classes WHERE id=?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "ÇáÞÓã ÛíÑ ãæÌæÏ" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "ÝÔá ÍÐÝ ÇáÞÓã", error: e.message });
  }
};

exports.listStudyPeriods = async (req, res) => {
  try {
    const data = await loadStudyPeriods();
    res.json({ data });
  } catch (e) {
    res.status(500).json({ message: "Failed to load study periods", error: e.message });
  }
};

exports.saveStudyPeriods = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.periods) ? req.body.periods : [];
    const sanitized = [];
    for (const item of items) {
      const entry = sanitizeStudyPeriodInput(item);
      if (entry) sanitized.push(entry);
    }
    const activeEntries = sanitized.filter((entry) => entry.is_active);
    await pool.execute("DELETE FROM timetable_study_periods");
    if (activeEntries.length) {
      const clause = activeEntries.map(() => "(?, ?, ?, ?)").join(", ");
      const params = [];
      for (const entry of activeEntries) {
        params.push(entry.day_id, entry.period_id, entry.cycle, entry.is_active ? 1 : 0);
      }
      await pool.execute(
        `INSERT INTO timetable_study_periods (day_id, period_id, cycle, is_active) VALUES ${clause}`,
        params
      );
    }
    const data = await loadStudyPeriods();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ message: "Failed to save study periods", error: e.message });
  }
};
