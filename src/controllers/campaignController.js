const pool = require("../db");
const { applyVars } = require("../services/templateEngine");
const { sleep, toDigitsMorocco, toJid, sendOne } = require("../services/whatsapp/queue");
const { logger } = require("../utils/logger");

const sending = new Set();

function roleCanSendMode(role, mode) {
  const r = String(role || "").toUpperCase();
  if (r === "DIRECTOR") return true;
  if (r === "TIMETABLE_OFFICER") return mode === "GENERAL";
  if (r === "ADMIN") return true;
  if (r === "ABSENCE_OFFICER") return mode === "ABSENCE";
  return false;
}

function pickStudentVars(s) {
  return {
    name: s.full_name,
    level: s.level,
    class: s.class_name,
    massar: s.massar_code,
    classNumber: s.class_number ?? "",
    passMassar: s.massar_password ?? "",
  };
}

function pickTeacherVars(t) {
  return {
    name: t.full_name,
    cin: t.code_cin,
  };
}

exports.getCampaign = async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "معرّف غير صالح" });

  const [[row]] = await pool.execute(
    "SELECT id, created_by, audience, mode, message_body, media_path, filter_json, status, total_count, sent_count, created_at, started_at, finished_at FROM campaigns WHERE id = ?",
    [id]
  );

  if (!row) return res.status(404).json({ message: "الحملة غير موجودة" });
  if (req.user.role === "ABSENCE_OFFICER" && row.mode !== "ABSENCE") {
    return res.status(404).json({ message: "الحملة غير موجودة" });
  }
  if (req.user.role === "TIMETABLE_OFFICER" && row.mode !== "GENERAL") {
    return res.status(404).json({ message: "الحملة غير موجودة" });
  }

  res.json({
    ...row,
    filter_json: row.filter_json ? JSON.parse(row.filter_json) : null,
  });
};

exports.createCampaign = async (req, res) => {
  let connection;
  try {
    let { audience, mode, message_body, ids, student_targets, extra_phones, filter_json, absence_date } = req.body || {};
    if (!audience || !mode || !message_body) return res.status(400).json({ message: "المعطيات ناقصة" });

    if (mode === "ABSENCE") {
      if (!absence_date) return res.status(400).json({ message: "تاريخ الغياب مطلوب لرسائل الغياب" });
      audience = "STUDENTS"; // Force audience for absence
      if (ids !== undefined) {
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).json({ message: "المرجو تحديد التلاميذ" });
        }
      }
    } else {
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "لائحة المعرفات مطلوبة" });
    }

    if (!roleCanSendMode(req.user.role, mode)) return res.status(403).json({ message: "غير مسموح بإرسال هذا النوع" });

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const media_path = req.body.media_path || null;

    const [rCamp] = await connection.execute(
      `INSERT INTO campaigns (created_by, audience, mode, message_body, media_path, filter_json, status, total_count)
       VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', 0)`,
      [req.user.id, audience, mode, message_body, media_path, filter_json ? JSON.stringify(filter_json) : null]
    );
    const campaignId = rCamp.insertId;

    let logs = [];

    if (audience === "STUDENTS") {
      // If `student_targets` is explicitly provided (even as an empty array),
      // respect it. Only default when it's missing.
      const targets = Array.isArray(student_targets) ? student_targets : ["FATHER", "MOTHER", "GUARDIAN"];

      let students = [];
      let absenceHoursByStudentId = {};

      if (mode === "ABSENCE") {
        if (Array.isArray(ids) && ids.length) {
          const placeholders = ids.map(() => "?").join(",");
          const [studentsRows] = await connection.execute(
            `SELECT id, class_number, massar_code, massar_password, full_name, level, class_name, father_phone, mother_phone, guardian_phone
	               FROM students WHERE id IN (${placeholders})`,
            ids
          );
          students = studentsRows;
        } else {
          const f = filter_json || {};
          const section = typeof f.section === "string" ? f.section.trim() : "";
          const status = typeof f.status === "string" ? f.status.trim().toUpperCase() : "";
          const absenceType = typeof f.absence_type === "string" ? f.absence_type.trim().toUpperCase() : "";

          const where = ["a.absence_date = ?"];
          const params = [absence_date];

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

          const [absentRows] = await connection.execute(
            `SELECT DISTINCT s.id, s.class_number, s.massar_code, s.massar_password, s.full_name, s.level, s.class_name, s.father_phone, s.mother_phone, s.guardian_phone
	               FROM absences a
	               JOIN students s ON a.student_id = s.id
	              WHERE ${where.join(" AND ")}
	              ORDER BY s.class_name, s.full_name`,
            params
          );
          students = absentRows;
        }
      } else {
        const placeholders = ids.map(() => "?").join(",");
        const [studentsRows] = await connection.execute(
          `SELECT id, class_number, massar_code, massar_password, full_name, level, class_name, father_phone, mother_phone, guardian_phone
           FROM students WHERE id IN (${placeholders})`,
          ids
        );
        students = studentsRows;
      }

      if (mode === "ABSENCE" && students.length) {
        const f = filter_json || {};
        const section = typeof f.section === "string" ? f.section.trim() : "";
        const absenceType = typeof f.absence_type === "string" ? f.absence_type.trim().toUpperCase() : "";

        const studentIds = students.map((s) => s.id);
        const placeholders = studentIds.map(() => "?").join(",");
        const where = [`absence_date = ?`, `student_id IN (${placeholders})`];
        const params = [absence_date, ...studentIds];

        if (section) {
          where.push("section = ?");
          params.push(section);
        }
        if (absenceType && ["JUSTIFIED", "UNJUSTIFIED"].includes(absenceType)) {
          where.push("absence_type = ?");
          params.push(absenceType);
        }

        const [hoursRows] = await connection.execute(
          `SELECT student_id, COUNT(DISTINCT period_number) AS hours
	             FROM absences
	            WHERE ${where.join(" AND ")}
	            GROUP BY student_id`,
          params
        );

        for (const r of hoursRows) {
          absenceHoursByStudentId[Number(r.student_id)] = Number(r.hours || 0);
        }
      }

      for (const s of students) {
        const seenJids = new Set();
        const vars = {
          ...pickStudentVars(s),
          ...(mode === "ABSENCE"
            ? {
              absence_date: absence_date,
              absence_hours: absenceHoursByStudentId[Number(s.id)] || 0,
            }
            : {}),
        };
        const mapPhoneByType = { FATHER: s.father_phone, MOTHER: s.mother_phone, GUARDIAN: s.guardian_phone };

        for (const type of targets) {
          const rawPhone = mapPhoneByType[type];
          const digits = toDigitsMorocco(rawPhone);
          const jid = toJid(digits);

          // If multiple targets share the same number, send only once.
          if (jid && seenJids.has(jid)) continue;
          if (jid) seenJids.add(jid);

          if (!jid) {
            logs.push({
              campaign_id: campaignId,
              recipient_type: type,
              recipient_ref_id: s.id,
              recipient_name: s.full_name,
              phone: rawPhone || null,
              wa_jid: null,
              vars_json: JSON.stringify(vars),
              status: "SKIPPED",
              error_text: "NO_PHONE",
            });
          } else {
            logs.push({
              campaign_id: campaignId,
              recipient_type: type,
              recipient_ref_id: s.id,
              recipient_name: s.full_name,
              phone: digits,
              wa_jid: jid,
              vars_json: JSON.stringify(vars),
              status: "PENDING",
              error_text: null,
            });
          }
        }
      }

      const extra = Array.isArray(extra_phones) ? extra_phones : [];
      const extraClean = extra
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 10);

      if (extraClean.length) {
        if (!Array.isArray(ids) || ids.length !== 1) {
          return res.status(400).json({ message: "extra_phones يتطلب اختيار تلميذ واحد فقط" });
        }
        if (students.length !== 1) {
          return res.status(400).json({ message: "تعذر تحديد التلميذ لإرسال رقم إضافي" });
        }

        const s = students[0];
        const vars = {
          ...pickStudentVars(s),
          ...(mode === "ABSENCE"
            ? {
              absence_date: absence_date,
              absence_hours: absenceHoursByStudentId[Number(s.id)] || 0,
            }
            : {}),
        };

        const seenJids = new Set();
        // Avoid sending duplicates when OTHER phone matches a target phone.
        for (const t of ["FATHER", "MOTHER", "GUARDIAN"]) {
          const digits = toDigitsMorocco((s || {})[`${t.toLowerCase()}_phone`]);
          const jid = toJid(digits);
          if (jid) seenJids.add(jid);
        }

        for (const raw of extraClean) {
          const digits = toDigitsMorocco(raw);
          const jid = toJid(digits);

          if (jid && seenJids.has(jid)) continue;
          if (jid) seenJids.add(jid);

          if (!jid) {
            logs.push({
              campaign_id: campaignId,
              recipient_type: "OTHER",
              recipient_ref_id: s.id,
              recipient_name: s.full_name,
              phone: raw || null,
              wa_jid: null,
              vars_json: JSON.stringify(vars),
              status: "SKIPPED",
              error_text: "NO_PHONE",
            });
          } else {
            logs.push({
              campaign_id: campaignId,
              recipient_type: "OTHER",
              recipient_ref_id: s.id,
              recipient_name: s.full_name,
              phone: digits,
              wa_jid: jid,
              vars_json: JSON.stringify(vars),
              status: "PENDING",
              error_text: null,
            });
          }
        }
      }
    } else if (audience === "TEACHERS") {
      const placeholders = ids.map(() => "?").join(",");
      const [teachers] = await connection.execute(
        `SELECT id, full_name, code_cin, phone
         FROM teachers WHERE id IN (${placeholders})`,
        ids
      );

      for (const t of teachers) {
        const vars = pickTeacherVars(t);
        const digits = toDigitsMorocco(t.phone);
        const jid = toJid(digits);

        if (!jid) {
          logs.push({
            campaign_id: campaignId,
            recipient_type: "TEACHER",
            recipient_ref_id: t.id,
            recipient_name: t.full_name,
            phone: t.phone || null,
            wa_jid: null,
            vars_json: JSON.stringify(vars),
            status: "SKIPPED",
            error_text: "NO_PHONE",
          });
        } else {
          logs.push({
            campaign_id: campaignId,
            recipient_type: "TEACHER",
            recipient_ref_id: t.id,
            recipient_name: t.full_name,
            phone: digits,
            wa_jid: jid,
            vars_json: JSON.stringify(vars),
            status: "PENDING",
            error_text: null,
          });
        }
      }
    } else {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: "فئة المستهدفين غير صالحة" });
    }

    if (logs.length > 0) {
      const chunkSize = 300;
      for (let i = 0; i < logs.length; i += chunkSize) {
        const chunk = logs.slice(i, i + chunkSize);
        const values = []
        const placeholders = chunk.map(() => "(?,?,?,?,?,?,?, ?,?,?,?,?)").join(",");

        for (const L of chunk) {
          values.push(
            campaignId,
            L.recipient_type,
            L.recipient_ref_id,
            L.recipient_name,
            L.phone,
            L.vars_json,
            L.wa_jid,
            L.status,
            L.error_text,
            null,
            0,
            null
          );
        }

        await connection.execute(
          `INSERT INTO message_logs
              (campaign_id, recipient_type, recipient_ref_id, recipient_name, phone, vars_json, wa_jid,
              status, error_text, wa_message_id, attempt, sent_at)
            VALUES ${placeholders}`,
          values
        );
      }
    }


    const total_count = logs.filter(x => x.status === "PENDING").length;
    const skipped = logs.filter(x => x.status === "SKIPPED").length;

    await connection.execute("UPDATE campaigns SET total_count=?, failed_count=0, sent_count=0, status='QUEUED' WHERE id=?",
      [total_count, campaignId]);

    await connection.commit();

    logger.campaign("created", campaignId, {
      userId: req.user.id,
      audience,
      mode,
      totalRecipients: total_count,
      skipped,
    });

    res.json({ ok: true, campaignId, total_count, skipped });
  } catch (e) {
    if (connection) {
      await connection.rollback();
    }
    logger.error("Failed to create campaign", e, { userId: req.user?.id, data: req.body });
    res.status(500).json({ message: "فشل إنشاء الحملة", error: e.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

exports.sendCampaign = async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!campaignId) return res.status(400).json({ message: "معرّف غير صالح" });

  if (sending.has(campaignId)) return res.status(409).json({ message: "الحملة قيد الإرسال بالفعل" });

  const [cRows] = await pool.execute("SELECT id, mode, status FROM campaigns WHERE id=? LIMIT 1", [campaignId]);
  const camp = cRows[0];
  if (!camp) return res.status(404).json({ message: "الحملة غير موجودة" });

  if (["DONE", "CANCELED"].includes(String(camp.status || ""))) {
    return res.status(400).json({ message: "لا يمكن إرسال حملة مكتملة أو ملغاة" });
  }
  if (String(camp.status || "") === "SENDING") {
    return res.status(409).json({ message: "الحملة قيد الإرسال بالفعل" });
  }

  if (!roleCanSendMode(req.user.role, camp.mode)) return res.status(403).json({ message: "غير مسموح بإرسال هذا النوع" });

  sending.add(campaignId);

  logger.campaign("started", campaignId, {
    userId: req.user.id,
    mode: camp.mode,
  });

  res.json({ ok: true, started: true });

  try {
    const [[settings]] = await pool.execute("SELECT send_delay_ms FROM settings WHERE id=1");
    const delay = Number(settings?.send_delay_ms || 4000);

    await pool.execute("UPDATE campaigns SET status='SENDING', started_at=NOW(), finished_at=NULL WHERE id=?", [campaignId]);

    let sent = 0, failed = 0;

    while (true) {
      const [[stRow]] = await pool.execute("SELECT status FROM campaigns WHERE id=? LIMIT 1", [campaignId]);
      const curStatus = String(stRow?.status || "");
      if (curStatus !== "SENDING") break;

      const [logs] = await pool.execute(
        `SELECT id, wa_jid, vars_json
           FROM message_logs
          WHERE campaign_id=? AND status='PENDING'
          ORDER BY id ASC
          LIMIT 50`,
        [campaignId]
      );
      if (logs.length === 0) break;

      const [c2] = await pool.execute("SELECT message_body, media_path FROM campaigns WHERE id=? LIMIT 1", [campaignId]);
      const camp2 = c2[0];
      const body = camp2.message_body;
      const mediaPath = camp2.media_path || null;

      for (const L of logs) {
        const [[stRow2]] = await pool.execute("SELECT status FROM campaigns WHERE id=? LIMIT 1", [campaignId]);
        const curStatus2 = String(stRow2?.status || "");
        if (curStatus2 !== "SENDING") break;

        try {
          const vars = L.vars_json ? JSON.parse(L.vars_json) : {};
          const text = applyVars(body, vars);

          const r = await sendOne({ jid: L.wa_jid, text, mediaPath });

          if (r.skipped) {
            failed++;
            await pool.execute("UPDATE message_logs SET status='FAILED', error_text=?, attempt=attempt+1 WHERE id=?",
              [r.reason || "SKIPPED", L.id]);
          } else {
            sent++;
            await pool.execute("UPDATE message_logs SET status='SENT', wa_message_id=?, sent_at=NOW(), attempt=attempt+1 WHERE id=?",
              [r.messageId || null, L.id]);
          }
        } catch (e) {
          failed++;
          await pool.execute("UPDATE message_logs SET status='FAILED', error_text=?, attempt=attempt+1 WHERE id=?",
            [e.message || "SEND_FAILED", L.id]);
        }

        await pool.execute("UPDATE campaigns SET sent_count=?, failed_count=? WHERE id=?", [sent, failed, campaignId]);
        await sleep(delay);
      }
    }

    await pool.execute("UPDATE campaigns SET status='DONE', finished_at=NOW() WHERE id=? AND status='SENDING'", [campaignId]);

    logger.campaign("completed", campaignId, {
      totalSent: sent,
      totalFailed: failed,
    });
  } catch (e) {
    logger.error("Campaign sending failed", e, { campaignId });
    await pool.execute("UPDATE campaigns SET status='FAILED', finished_at=NOW() WHERE id=? AND status='SENDING'", [campaignId]);
  } finally {
    sending.delete(campaignId);
  }
};

exports.stopCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    if (!campaignId) return res.status(400).json({ message: "معرّف غير صالح" });

    const [[c]] = await pool.execute("SELECT id, status FROM campaigns WHERE id=? LIMIT 1", [campaignId]);
    if (!c) return res.status(404).json({ message: "الحملة غير موجودة" });

    const status = String(c.status || "");
    if (["DONE", "FAILED", "CANCELED"].includes(status)) {
      return res.status(400).json({ message: "لا يمكن إيقاف حملة منتهية/فاشلة/ملغاة" });
    }

    await pool.execute("UPDATE campaigns SET status='STOPPED', finished_at=NOW() WHERE id=?", [campaignId]);

    logger.campaign("stopped", campaignId, { userId: req.user.id });

    res.json({ ok: true, status: "STOPPED" });
  } catch (e) {
    logger.error("Failed to stop campaign", e, { campaignId: req.params.id, userId: req.user?.id });
    res.status(500).json({ ok: false, message: "خطأ أثناء إيقاف الحملة", error: e.message });
  }
};

exports.cancelCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    if (!campaignId) return res.status(400).json({ message: "معرّف غير صالح" });

    const [[c]] = await pool.execute("SELECT id, status FROM campaigns WHERE id=? LIMIT 1", [campaignId]);
    if (!c) return res.status(404).json({ message: "الحملة غير موجودة" });

    const status = String(c.status || "");
    if (["DONE", "CANCELED"].includes(status)) {
      return res.status(400).json({ message: "الحملة مكتملة أو ملغاة بالفعل" });
    }

    await pool.execute("UPDATE campaigns SET status='CANCELED', finished_at=NOW() WHERE id=?", [campaignId]);
    await pool.execute(
      "UPDATE message_logs SET status='SKIPPED', error_text='CANCELED' WHERE campaign_id=? AND status='PENDING'",
      [campaignId]
    );

    logger.campaign("canceled", campaignId, { userId: req.user.id });

    res.json({ ok: true, status: "CANCELED" });
  } catch (e) {
    logger.error("Failed to cancel campaign", e, { campaignId: req.params.id, userId: req.user?.id });
    res.status(500).json({ ok: false, message: "خطأ أثناء إلغاء الحملة", error: e.message });
  }
};

exports.getCampaignLogs = async (req, res) => {
  const campaignId = Number(req.params.id);
  const status = req.query.status || null;

  const [[camp]] = await pool.execute(
    `SELECT c.id, c.mode, c.created_by, u.full_name AS created_by_name
       FROM campaigns c
       LEFT JOIN users u ON u.id = c.created_by
      WHERE c.id=? LIMIT 1`,
    [campaignId]
  );
  if (!camp) return res.status(404).json({ message: "الحملة غير موجودة" });
  if (req.user.role === "ABSENCE_OFFICER" && camp.mode !== "ABSENCE") {
    return res.status(404).json({ message: "الحملة غير موجودة" });
  }
  if (req.user.role === "TIMETABLE_OFFICER" && camp.mode !== "GENERAL") {
    return res.status(404).json({ message: "الحملة غير موجودة" });
  }

  const params = [campaignId];
  let where = "campaign_id=?";
  if (status) {
    where += " AND status=?";
    params.push(status);
  }

  const [rows] = await pool.execute(
    `SELECT id, recipient_type, recipient_name, phone, status, error_text, sent_at
       FROM message_logs
      WHERE ${where}
      ORDER BY id DESC
      LIMIT 5000`,
    params
  );

  res.json({
    meta: {
      campaign_id: camp.id,
      mode: camp.mode,
      created_by: camp.created_by || null,
      created_by_name: camp.created_by_name || null,
    },
    rows,
  });
};

exports.listCampaigns = async (req, res) => {
  const role = String(req.user?.role || "").toUpperCase();
  let where = "";
  if (role === "ABSENCE_OFFICER") where = "WHERE mode='ABSENCE'";
  else if (role === "TIMETABLE_OFFICER") where = "WHERE mode='GENERAL'";

  const [rows] = await pool.execute(
    `SELECT id, audience, mode, status, total_count, sent_count, failed_count, created_at, started_at, finished_at
       FROM campaigns
      ${where}
      ORDER BY id DESC
      LIMIT 200`
  );
  res.json(rows);
};
