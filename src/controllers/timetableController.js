const pool = require("../db");

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

async function getClassById(classId) {
  const [[row]] = await pool.execute(
    "SELECT id, level, classe, cycle, is_active, `order` FROM classes WHERE id=?",
    [classId]
  );
  return row || null;
}

async function getActiveDays() {
  const [rows] = await pool.execute(
    "SELECT id, code, label_ar, `order` AS day_order FROM timetable_days WHERE is_active=1 ORDER BY `order` ASC"
  );
  return rows;
}

async function getActivePeriods() {
  const [rows] = await pool.execute(
    "SELECT id, code, start_time, end_time, `order` AS period_number FROM timetable_periods WHERE is_active=1 ORDER BY `order` ASC"
  );
  return rows;
}

async function getStudyMatrixForCycle(cycle) {
  // returns map key day_id|period_id => is_active
  const [rows] = await pool.execute(
    "SELECT day_id, period_id, is_active FROM timetable_study_periods WHERE cycle=?",
    [String(cycle || "").toUpperCase()]
  );
  const map = {};
  for (const r of rows) {
    map[`${r.day_id}|${r.period_id}`] = Boolean(r.is_active);
  }
  return map;
}

async function getCurrentSlotsForClass(classId) {
  const [rows] = await pool.execute(
    `SELECT t.id, t.class_id, t.day_id, t.period_id, t.subject_id, t.teacher_id,
            s.name_ar AS subject_name, s.code AS subject_code,
            tr.full_name AS teacher_name
     FROM timetables t
     JOIN subjects s ON s.id=t.subject_id
     JOIN teachers tr ON tr.id=t.teacher_id
     WHERE t.class_id=?
     ORDER BY t.day_id ASC, t.period_id ASC`,
    [classId]
  );
  return rows;
}

async function getWorkloadForLevel(level) {
  const [rows] = await pool.execute(
    `SELECT ls.subject_id, ls.weekly_periods, ls.is_active,
            s.name_ar, s.code, s.is_global
     FROM level_subjects ls
     JOIN subjects s ON s.id=ls.subject_id
     WHERE ls.level=? AND ls.is_active=1 AND ls.weekly_periods>0 AND s.is_active=1
     ORDER BY s.name_ar ASC`,
    [String(level || "").trim()]
  );
  return rows;
}

async function getEligibleTeachersBySubject(classId) {
  const [rows] = await pool.execute(
    `SELECT ts.subject_id, t.id AS teacher_id, t.full_name
     FROM teacher_subjects ts
     JOIN teachers t ON t.id=ts.teacher_id
     JOIN teacher_classes tc ON tc.teacher_id=t.id AND tc.class_id=?
     ORDER BY ts.subject_id ASC, t.full_name ASC`,
    [classId]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.subject_id]) map[r.subject_id] = [];
    map[r.subject_id].push({ id: r.teacher_id, full_name: r.full_name });
  }
  return map;
}

// ------------------------
// Planner payload
// ------------------------

exports.getPlannerForClass = async (req, res) => {
  const classId = toInt(req.params.classId);
  if (!classId) return res.status(400).json({ message: "قسم غير صالح" });

  const cls = await getClassById(classId);
  if (!cls) return res.status(404).json({ message: "القسم غير موجود" });
  if (!cls.is_active) return res.status(400).json({ message: "القسم غير مفعل" });

  const [days, periods, studyMatrix, slots, workload, eligible] = await Promise.all([
    getActiveDays(),
    getActivePeriods(),
    getStudyMatrixForCycle(cls.cycle),
    getCurrentSlotsForClass(classId),
    getWorkloadForLevel(cls.level),
    getEligibleTeachersBySubject(classId),
  ]);

  // compute remaining per subject
  const placedCounts = {};
  for (const s of slots) {
    placedCounts[s.subject_id] = (placedCounts[s.subject_id] || 0) + 1;
  }
  const workloadWithRemaining = workload.map((w) => {
    const placed = placedCounts[w.subject_id] || 0;
    const total = Number(w.weekly_periods || 0);
    return {
      subject_id: w.subject_id,
      name_ar: w.name_ar,
      code: w.code,
      weekly_periods: total,
      placed,
      remaining: Math.max(0, total - placed),
      teachers: eligible[w.subject_id] || [],
    };
  });

  res.json({
    class: { id: cls.id, level: cls.level, classe: cls.classe, cycle: cls.cycle },
    days,
    periods,
    studyMatrix,
    slots,
    workload: workloadWithRemaining,
  });
};

// ------------------------
// Suggestions
// ------------------------

exports.getSuggestions = async (req, res) => {
  const classId = toInt(req.query.class_id);
  const subjectId = toInt(req.query.subject_id);
  const teacherId = toInt(req.query.teacher_id);
  if (!classId || !subjectId || !teacherId) {
    return res.status(400).json({ message: "معطيات ناقصة" });
  }

  const cls = await getClassById(classId);
  if (!cls) return res.status(404).json({ message: "القسم غير موجود" });

  // verify teacher can teach subject and assigned to class
  const [[qual]] = await pool.execute(
    `SELECT 1 AS ok
     FROM teacher_subjects ts
     JOIN teacher_classes tc ON tc.teacher_id=ts.teacher_id AND tc.class_id=?
     WHERE ts.teacher_id=? AND ts.subject_id=?
     LIMIT 1`,
    [classId, teacherId, subjectId]
  );
  if (!qual) return res.status(400).json({ message: "الأستاذ غير مؤهل لهذه المادة أو غير مسند لهذا القسم" });

  // Load active study periods (cycle) joined with days/periods to iterate
  const [activeStudy] = await pool.execute(
    `SELECT tsp.day_id, tsp.period_id
     FROM timetable_study_periods tsp
     WHERE tsp.cycle=? AND tsp.is_active=1`,
    [String(cls.cycle || "").toUpperCase()]
  );

  if (!activeStudy.length) return res.json({ data: [] });

  // occupied slots for class
  const [classOcc] = await pool.execute(
    "SELECT day_id, period_id FROM timetables WHERE class_id=?",
    [classId]
  );
  const classOccSet = new Set(classOcc.map((r) => `${r.day_id}|${r.period_id}`));

  // occupied slots for teacher
  const [teacherOcc] = await pool.execute(
    "SELECT day_id, period_id FROM timetables WHERE teacher_id=?",
    [teacherId]
  );
  const teacherOccSet = new Set(teacherOcc.map((r) => `${r.day_id}|${r.period_id}`));

  // availability matrix (if none row exists => default available)
  const [availRows] = await pool.execute(
    "SELECT day_id, period_id, is_available FROM teacher_availability WHERE teacher_id=?",
    [teacherId]
  );
  const availMap = {};
  for (const r of availRows) availMap[`${r.day_id}|${r.period_id}`] = Boolean(r.is_available);
  const hasAvail = availRows.length > 0;

  const suggestions = [];
  for (const sp of activeStudy) {
    const key = `${sp.day_id}|${sp.period_id}`;
    if (classOccSet.has(key)) continue;
    if (teacherOccSet.has(key)) continue;
    if (hasAvail && !availMap[key]) continue;
    suggestions.push({ day_id: sp.day_id, period_id: sp.period_id });
  }

  res.json({ data: suggestions });
};

// ------------------------
// Auto-fill (no conflicts)
// ------------------------

exports.autofillClass = async (req, res) => {
  const classId = toInt(req.params.classId);
  if (!classId) return res.status(400).json({ message: "قسم غير صالح" });

  const avoidSame = req.body?.avoid_same_subject_per_day !== false;
  const maxSamePerDay = toInt(req.body?.max_same_subject_per_day, 1) ?? 1;

  const cls = await getClassById(classId);
  if (!cls) return res.status(404).json({ message: "القسم غير موجود" });
  if (!cls.is_active) return res.status(400).json({ message: "القسم غير مفعل" });

  // Load core data
  const [workload, eligibleMap] = await Promise.all([
    getWorkloadForLevel(cls.level),
    getEligibleTeachersBySubject(classId),
  ]);

  // Active study slots for this cycle
  const [activeStudy] = await pool.execute(
    `SELECT tsp.day_id, tsp.period_id
     FROM timetable_study_periods tsp
     WHERE tsp.cycle=? AND tsp.is_active=1`,
    [String(cls.cycle || "").toUpperCase()]
  );

  if (!activeStudy.length) {
    return res.json({ ok: true, inserted: 0, unscheduled: workload.map(w=>({subject_id:w.subject_id, remaining:Number(w.weekly_periods||0)})) });
  }

  // Existing slots for class + counts
  const [existingSlots] = await pool.execute(
    "SELECT id, subject_id, teacher_id, day_id, period_id FROM timetables WHERE class_id=?",
    [classId]
  );

  const classOccSet = new Set(existingSlots.map((r) => `${r.day_id}|${r.period_id}`));
  const dayTotals = {};
  const daySubjectCounts = {};
  const placedCounts = {};
  for (const s of existingSlots) {
    placedCounts[s.subject_id] = (placedCounts[s.subject_id] || 0) + 1;
    dayTotals[s.day_id] = (dayTotals[s.day_id] || 0) + 1;
    if (!daySubjectCounts[s.day_id]) daySubjectCounts[s.day_id] = {};
    daySubjectCounts[s.day_id][s.subject_id] = (daySubjectCounts[s.day_id][s.subject_id] || 0) + 1;
  }

  // Build remaining tasks (subject repeated remaining times)
  const remainingBySubject = {};
  for (const w of workload) {
    const total = Number(w.weekly_periods || 0);
    const placed = placedCounts[w.subject_id] || 0;
    const remaining = Math.max(0, total - placed);
    if (remaining > 0) remainingBySubject[w.subject_id] = remaining;
  }

  // Collect eligible teachers list
  const teacherIdsSet = new Set();
  for (const subjectIdStr of Object.keys(remainingBySubject)) {
    const subjectId = Number(subjectIdStr);
    const teachers = eligibleMap[subjectId] || [];
    for (const t of teachers) teacherIdsSet.add(t.id);
  }
  const teacherIds = Array.from(teacherIdsSet);

  if (!teacherIds.length) {
    return res.status(400).json({ message: "لا يوجد أساتذة مؤهلون/مسندون لهذه الأقسام/المواد" });
  }

  // Teacher occupied sets
  const teacherOcc = {};
  for (const id of teacherIds) teacherOcc[id] = new Set();
  {
    const [rows] = await pool.query(
      `SELECT teacher_id, day_id, period_id FROM timetables WHERE teacher_id IN (${teacherIds.map(()=>"?").join(",")})`,
      teacherIds
    );
    for (const r of rows) teacherOcc[r.teacher_id]?.add(`${r.day_id}|${r.period_id}`);
  }

  // Teacher availability maps
  const teacherHasAvail = new Set();
  const teacherAvail = {};
  for (const id of teacherIds) teacherAvail[id] = {};
  {
    const [rows] = await pool.query(
      `SELECT teacher_id, day_id, period_id, is_available FROM teacher_availability WHERE teacher_id IN (${teacherIds.map(()=>"?").join(",")})`,
      teacherIds
    );
    for (const r of rows) {
      teacherHasAvail.add(r.teacher_id);
      teacherAvail[r.teacher_id][`${r.day_id}|${r.period_id}`] = Boolean(r.is_available);
    }
  }

  // Helper: iterate subjects by highest remaining first
  function pickNextSubject() {
    let best = null;
    let bestRem = -1;
    for (const [sid, rem] of Object.entries(remainingBySubject)) {
      const r = Number(rem);
      if (r > bestRem) {
        bestRem = r;
        best = Number(sid);
      }
    }
    return best;
  }

  const placements = [];

  // Greedy fill
  while (true) {
    const subjectId = pickNextSubject();
    if (!subjectId) break;

    const teachers = eligibleMap[subjectId] || [];
    if (!teachers.length) {
      // cannot place this subject at all
      delete remainingBySubject[subjectId];
      continue;
    }

    let bestCand = null;

    for (const sp of activeStudy) {
      const key = `${sp.day_id}|${sp.period_id}`;
      if (classOccSet.has(key)) continue;

      // avoid repeating same subject too much per day
      const sameCount = (daySubjectCounts[sp.day_id]?.[subjectId] || 0);
      if (avoidSame && sameCount >= maxSamePerDay) continue;

      for (const t of teachers) {
        const tid = t.id;
        if (teacherOcc[tid]?.has(key)) continue;
        if (teacherHasAvail.has(tid) && teacherAvail[tid][key] === false) continue;

        const dayLoad = dayTotals[sp.day_id] || 0;
        const score = 1000 - dayLoad * 10 - sameCount * 60 - (sp.period_id * 0.2);

        if (!bestCand || score > bestCand.score) {
          bestCand = {
            day_id: sp.day_id,
            period_id: sp.period_id,
            teacher_id: tid,
            subject_id: subjectId,
            score,
          };
        }
      }
    }

    if (!bestCand) {
      // no available slots left for this subject -> stop placing it
      delete remainingBySubject[subjectId];
      continue;
    }

    // Apply placement to in-memory state
    const key = `${bestCand.day_id}|${bestCand.period_id}`;
    classOccSet.add(key);
    teacherOcc[bestCand.teacher_id].add(key);
    dayTotals[bestCand.day_id] = (dayTotals[bestCand.day_id] || 0) + 1;
    if (!daySubjectCounts[bestCand.day_id]) daySubjectCounts[bestCand.day_id] = {};
    daySubjectCounts[bestCand.day_id][subjectId] = (daySubjectCounts[bestCand.day_id][subjectId] || 0) + 1;

    placements.push({
      class_id: classId,
      day_id: bestCand.day_id,
      period_id: bestCand.period_id,
      subject_id: subjectId,
      teacher_id: bestCand.teacher_id,
    });

    remainingBySubject[subjectId] -= 1;
    if (remainingBySubject[subjectId] <= 0) delete remainingBySubject[subjectId];

    // Safety: if we filled all possible class slots, stop
    if (classOccSet.size >= activeStudy.length) break;
  }

  if (!placements.length) {
    return res.json({ ok: true, inserted: 0, unscheduled: Object.entries(remainingBySubject).map(([subject_id, remaining]) => ({ subject_id: Number(subject_id), remaining: Number(remaining) })) });
  }

  // Insert placements in a transaction
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of placements) {
      await conn.execute(
        "INSERT INTO timetables (class_id, day_id, period_id, subject_id, teacher_id, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [p.class_id, p.day_id, p.period_id, p.subject_id, p.teacher_id, req.user?.id || null]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (String(e?.code || "") === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "تعارض أثناء التعبئة التلقائية (ربما تم تعديل الجدول بالتوازي). أعد المحاولة." });
    }
    throw e;
  } finally {
    conn.release();
  }

  return res.json({
    ok: true,
    inserted: placements.length,
    unscheduled: Object.entries(remainingBySubject).map(([subject_id, remaining]) => ({
      subject_id: Number(subject_id),
      remaining: Number(remaining),
    })),
  });
};


// ------------------------
// Slot CRUD (with conflict checks)
// ------------------------

exports.createSlot = async (req, res) => {
  const class_id = toInt(req.body?.class_id);
  const day_id = toInt(req.body?.day_id);
  const period_id = toInt(req.body?.period_id);
  const subject_id = toInt(req.body?.subject_id);
  const teacher_id = toInt(req.body?.teacher_id);

  if (!class_id || !day_id || !period_id || !subject_id || !teacher_id) {
    return res.status(400).json({ message: "معطيات ناقصة" });
  }

  const cls = await getClassById(class_id);
  if (!cls) return res.status(404).json({ message: "القسم غير موجود" });

  // Ensure study period active for cycle
  const [[sp]] = await pool.execute(
    "SELECT 1 AS ok FROM timetable_study_periods WHERE cycle=? AND day_id=? AND period_id=? AND is_active=1 LIMIT 1",
    [String(cls.cycle || "").toUpperCase(), day_id, period_id]
  );
  if (!sp) return res.status(400).json({ message: "هذه الحصة غير مفعّلة لهذا السلك" });

  // Ensure teacher qualified + assigned
  const [[qual]] = await pool.execute(
    `SELECT 1 AS ok
     FROM teacher_subjects ts
     JOIN teacher_classes tc ON tc.teacher_id=ts.teacher_id AND tc.class_id=?
     WHERE ts.teacher_id=? AND ts.subject_id=?
     LIMIT 1`,
    [class_id, teacher_id, subject_id]
  );
  if (!qual) return res.status(400).json({ message: "الأستاذ غير مؤهل لهذه المادة أو غير مسند لهذا القسم" });

  // Availability
  const [availRows] = await pool.execute(
    "SELECT is_available FROM teacher_availability WHERE teacher_id=? AND day_id=? AND period_id=?",
    [teacher_id, day_id, period_id]
  );
  if (availRows.length && !Boolean(availRows[0].is_available)) {
    return res.status(400).json({ message: "الأستاذ غير متاح في هذه الحصة" });
  }

  // Conflicts: class slot + teacher slot
  const [[confClass]] = await pool.execute(
    "SELECT id FROM timetables WHERE class_id=? AND day_id=? AND period_id=? LIMIT 1",
    [class_id, day_id, period_id]
  );
  if (confClass) return res.status(409).json({ message: "هذه الخانة مستعملة بالفعل للقسم" });

  const [[confTeacher]] = await pool.execute(
    "SELECT id, class_id FROM timetables WHERE teacher_id=? AND day_id=? AND period_id=? LIMIT 1",
    [teacher_id, day_id, period_id]
  );
  if (confTeacher) return res.status(409).json({ message: "الأستاذ عنده حصة أخرى في نفس الوقت" });

  try {
    const [result] = await pool.execute(
      "INSERT INTO timetables (class_id, day_id, period_id, subject_id, teacher_id, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [class_id, day_id, period_id, subject_id, teacher_id, req.user?.id || null]
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (e) {
    // Duplicate key from UNIQUE constraints
    if (String(e?.code || "") === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "تعارض: الخانة مستعملة" });
    }
    throw e;
  }
};

exports.deleteSlot = async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ message: "معرف غير صالح" });
  const [result] = await pool.execute("DELETE FROM timetables WHERE id=?", [id]);
  if (result.affectedRows === 0) return res.status(404).json({ message: "غير موجود" });
  res.json({ ok: true });
};

exports.deleteAllClassSlots = async (req, res) => {
  const classId = toInt(req.params.classId);
  if (!classId) return res.status(400).json({ message: "معرف القسم غير صالح" });
  
  // Check if class exists
  const cls = await getClassById(classId);
  if (!cls) return res.status(404).json({ message: "القسم غير موجود" });
  
  const [result] = await pool.execute("DELETE FROM timetables WHERE class_id=?", [classId]);
  res.json({ 
    ok: true, 
    deleted: result.affectedRows,
    message: `تم حذف ${result.affectedRows} حصة من القسم ${cls.classe}`
  });
};
