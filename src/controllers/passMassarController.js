const pool = require("../db");
const puppeteer = require("puppeteer");

function normStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

async function launchBrowser() {
  const launchOptions = { headless: "new" };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!process.env.PUPPETEER_SKIP_SANDBOX) launchOptions.args = ["--no-sandbox", "--disable-setuid-sandbox"];

  try {
    return await puppeteer.launch(launchOptions);
  } catch {
    const fallback = { headless: "new" };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) fallback.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    return puppeteer.launch(fallback);
  }
}

async function loadActiveStudents({ className, classNumber }) {
  const where = ["status IN ('STUDYING','INCOMING','REFERRED','ADDED')"];
  const params = [];

  if (className) {
    where.push("class_name = ?");
    params.push(className);
  }
  if (classNumber !== null && classNumber !== undefined && String(classNumber) !== "") {
    where.push("class_number = ?");
    params.push(Number(classNumber));
  }

  return { where, params };
}

exports.list = async (req, res) => {
  try {
    const className = normStr(req.query.class || req.query.class_name);
    const classNumber = req.query.class_number;
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 30) || 30));
    const offset = (page - 1) * limit;

    const [classesRows] = await pool.execute(
      `SELECT DISTINCT class_name
         FROM students
        WHERE status IN ('STUDYING','INCOMING','REFERRED','ADDED')
          AND class_name IS NOT NULL AND class_name <> ''
        ORDER BY class_name`
    );
    const classes = (classesRows || []).map((r) => String(r.class_name)).filter(Boolean);

    // Force choosing a single class (no "all")
    if (!className) {
      return res.json({
        ok: true,
        data: [],
        meta: { page, limit, total: 0, totalPages: 0 },
        options: { classes },
      });
    }

    const built = await loadActiveStudents({ className, classNumber });
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total
         FROM students
        WHERE ${built.where.join(" AND ")}`,
      built.params
    );
    const total = Number(countRow?.total || 0);
    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

    const [rows] = await pool.execute(
      `SELECT id, class_number, massar_code, massar_password, full_name, level, class_name
         FROM students
        WHERE ${built.where.join(" AND ")}
        ORDER BY class_name, class_number IS NULL, class_number, full_name, id
        LIMIT ? OFFSET ?`,
      [...built.params, limit, offset]
    );

    res.json({
      ok: true,
      data: rows || [],
      meta: { page, limit, total, totalPages },
      options: { classes },
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error loading pass massar list", error: e.message });
  }
};

function safeFilename(s) {
  const base = String(s || "list")
    .normalize("NFKD")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "list";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderListHtml({ rows, title }) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const cards = rows
    .map((r, i) => {
      const email = `${r.massar_code}@taalim.ma`;
      return `<div class="card">

        <div class="card-row">
          <div class="label">الاسم</div>
          <div class="value">${escapeHtml(r.full_name)}</div>
        </div>
        <div class="card-row">
          <div class="label">رقم التلميذ</div>
          <div class="value">${escapeHtml(r.class_number ?? "")}</div>
        </div>
        <div class="card-row">
          <div class="label">القسم</div>
          <div class="value">${escapeHtml(r.class_name)}</div>
        </div>
        <div class="card-row">
          <div class="label">البريد الإلكتروني</div>
          <div class="value">${escapeHtml(email)}</div>
        </div>
        <div class="card-row pass">
          <div class="label">القن السري</div>
          <div class="value">${escapeHtml(r.massar_password ?? "")}</div>
        </div>
      </div>`;
    })
    .join("\n");

  return `<!doctype html>
  <html lang="ar" dir="rtl">
    <head>
      <meta charset="utf-8" />
      <style>
        @page { size: A4; margin: 10mm; }
        body { font-family: Arial, "Noto Naskh Arabic", "Amiri", sans-serif; color: #0f172a; }
        .top { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 8px; }
        .title { font-size: 18px; font-weight: 800; }
        .meta { font-size: 12px; color:#475569; }
        .grid { display:flex; flex-wrap:wrap; gap:10px; }
        .card { box-sizing:border-box; width: calc(50% - 5px); border:1px solid #e2e8f0; padding:10px; border-radius:8px; background:#fff; page-break-inside:avoid; }
        .card-row { display:flex; justify-content:space-between; align-items:center; margin:6px 0; }
        .label { font-size:11px; color:#475569; width:30%;  }
        .value { font-size:13px; font-weight:600; width:70%;  }
        .pass .value { font-weight:800; letter-spacing:0.5px; color:#0b3b66; }
        .no-data { text-align:center; color:#64748b; padding:40px 0; }
      </style>
    </head>
    <body>
      ${rows.length === 0 ? `<div class="no-data">لا توجد معطيات</div>` : `<div class="grid">${cards}</div>`}
    </body>
  </html>`;
}

exports.pdfList = async (req, res) => {
  let browser = null;
  try {
    const className = normStr(req.query.class || req.query.class_name);
    const classNumber = req.query.class_number;
    const idsParam = req.query.ids || req.query.id;

    let rows;

    // If ids provided, generate PDF for those specific student ids
    if (idsParam) {
      const idsArr = Array.isArray(idsParam)
        ? idsParam.map((v) => Number(v)).filter(Boolean)
        : String(idsParam)
            .split(/[,\s]+/) // allow comma or space separated
            .map((v) => Number(v))
            .filter(Boolean);

      if (idsArr.length === 0) return res.status(400).json({ message: "No valid ids provided" });

      const placeholders = idsArr.map(() => "?").join(",");
      const [rowsRes] = await pool.execute(
        `SELECT id, class_number, massar_code, massar_password, full_name, level, class_name
           FROM students
          WHERE id IN (${placeholders})
          ORDER BY class_name, class_number IS NULL, class_number, full_name, id`,
        idsArr
      );
      rows = rowsRes || [];
    } else {
      if (!className) return res.status(400).json({ message: "المرجو اختيار قسم واحد للطباعة" });

      const built = await loadActiveStudents({ className, classNumber });
      const [rowsRes] = await pool.execute(
        `SELECT id, class_number, massar_code, massar_password, full_name, level, class_name
           FROM students
          WHERE ${built.where.join(" AND ")}
          ORDER BY class_name, class_number IS NULL, class_number, full_name, id`,
        built.params
      );
      rows = rowsRes || [];
    }

    const title = className ? `لائحة القن السري للتلاميذ — ${className}` : "لائحة القن السري للتلاميذ";

    const html = renderListHtml({ rows, title });

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });

    const filename = idsParam ? `passmassar_selected.pdf` : className ? `passmassar_${safeFilename(className)}.pdf` : "passmassar_list.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", Buffer.byteLength(pdf));
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.status(200).end(pdf);
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error generating PDF", error: e.message });
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
  }
};

exports.pdfOne = async (req, res) => {
  let browser = null;
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const [[row]] = await pool.execute(
      `SELECT id, class_number, massar_code, massar_password, full_name, level, class_name
         FROM students
        WHERE id=? LIMIT 1`,
      [id]
    );
    if (!row) return res.status(404).json({ message: "Student not found" });

    const html = renderListHtml({ rows: [row], title: `القن السري للتلميذ — ${row.full_name}` });

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", Buffer.byteLength(pdf));
    res.setHeader("Content-Disposition", `inline; filename="passmassar_${safeFilename(row.massar_code)}.pdf"`);
    res.status(200).end(pdf);
  } catch (e) {
    res.status(500).json({ ok: false, message: "Error generating PDF", error: e.message });
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
  }
};
