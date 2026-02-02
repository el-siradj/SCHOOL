const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const puppeteer = require("puppeteer-core"); // استخدام النسخة الخفيفة
const chromium = require("@sparticuz/chromium"); // استدعاء كروميوم الخاص بالكلاود
const qrcode = require("qrcode-terminal");
const fs = require("fs");

let client;
let state = { ready: false, lastQr: null, lastDisconnect: null };

// جعل الدالة async لأننا نحتاج انتظار تحميل مسار الكروميوم
async function initWhatsApp() {
  if (client) return client;

  console.log("[whatsapp] Initializing for Cloud/Hostinger environment...");

  try {
    // 1. إعداد مسار المتصفح حسب البيئة
    let executablePath;
    
    // محاولة الحصول على مسار كروميوم الخاص بالسيرفر
    try {
        executablePath = await chromium.executablePath();
    } catch (e) {
        console.error("Error getting chromium path:", e);
    }

    // fallback: إذا كنا نشتغل محلياً (Windows) قد نحتاج مسار كروم العادي
    // لكن في الكلاود، السطر أعلاه هو الذي سيعمل
    
    const navTimeoutMs = Math.max(15000, Number(process.env.WHATSAPP_NAV_TIMEOUT_MS || 60000));

    // 2. إعدادات Puppeteer المتوافقة مع الكلاود
    const puppeteerOptions = {
      args: [
        ...chromium.args, // إعدادات جاهزة من المكتبة
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // مهم جداً في دوكر/كلاود لتجنب امتلاء الذاكرة
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote", 
        "--single-process",
        "--disable-gpu",
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath, // المسار الذي جلبناه من المكتبة
      headless: chromium.headless, // "true" تلقائياً
      ignoreHTTPSErrors: true,
    };

    console.log("[whatsapp] Puppeteer config loaded. Path:", executablePath);

    const dataPath = path.join(process.cwd(), ".wwebjs_auth");
    
    // 3. إنشاء العميل
    client = new Client({
      authStrategy: new LocalAuth({ clientId: "school-notify", dataPath }),
      puppeteer: puppeteerOptions,
      puppeteerTimeout: navTimeoutMs,
    });

    // --- بقية الكود كما هو (Event Listeners) ---

    client.on("qr", (qr) => {
      state.lastQr = qr;
      state.ready = false;
      state.lastDisconnect = null;
      console.log("[whatsapp] QR received (len=", String(qr || "").length, ")");
      // طباعة الـ QR في التيرمينال للسيرفر
      qrcode.generate(qr, { small: true });
    });

    client.on("authenticated", () => {
      console.log("[whatsapp] client authenticated");
    });

    client.on("ready", () => {
      state.ready = true;
      state.lastQr = null;
      state.lastDisconnect = null;
      console.log("[whatsapp] client ready");
    });

    client.on("disconnected", (reason) => {
      state.ready = false;
      state.lastDisconnect = reason;
      console.log("[whatsapp] disconnected:", reason);
      scheduleReset();
    });

    client.on("auth_failure", (msg) => {
      state.ready = false;
      state.lastDisconnect = `auth_failure: ${msg}`;
      console.error("[whatsapp] auth_failure:", msg);
      scheduleReset();
    });

    await client.initialize();
    return client;

  } catch (err) {
    state.ready = false;
    state.lastDisconnect = err?.message || String(err);
    console.error("[whatsapp] initialize failed:", err?.message || err);
    scheduleReset();
  }
}

function getClient() {
  if (!client) throw new Error("WhatsApp client not initialized");
  return client;
}

function getState() {
  return state;
}

async function resetClient() {
  try {
    if (client) {
      try {
        await client.destroy();
      } catch (err) {
        console.error("[whatsapp] error destroying client:", err?.message || err);
      }
    }
  } finally {
    client = null;
    state.ready = false;
    state.lastQr = null;
    state.lastDisconnect = "reset";
    try {
      // بما أن initWhatsApp أصبحت async، لا بأس من مناداتها هكذا
      initWhatsApp();
    } catch (err) {
      console.error("[whatsapp] init after reset failed:", err?.message || err);
    }
  }
}

let _lastReset = 0;
function scheduleReset() {
  const now = Date.now();
  if (now - _lastReset < 5000) return;
  _lastReset = now;
  console.log("[whatsapp] scheduling client reset in 2s");
  setTimeout(() => {
    resetClient().catch((e) => console.error("[whatsapp] resetClient error:", e?.message || e));
  }, 2000);
}

module.exports = { initWhatsApp, getClient, getState, resetClient };