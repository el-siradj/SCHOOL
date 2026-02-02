const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const os = require("os"); // لمعرفة نوع النظام

let client;
let state = { ready: false, lastQr: null, lastDisconnect: null };

async function initWhatsApp() {
  if (client) return client;

  console.log("[whatsapp] Initializing...");

  try {
    let executablePath;

    // --- تحديد مسار المتصفح بذكاء ---
    if (os.platform() === "win32" || os.platform() === "darwin") {
      // 1. إذا كنا على Windows أو Mac (بيئة التطوير المحلية)
      console.log("[whatsapp] Detected Local Environment (Windows/Mac).");
      
      // مسارات كروم الشائعة في الويندوز
      const paths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" // للماك
      ];
      
      executablePath = paths.find(p => fs.existsSync(p));
      
      if (!executablePath) {
        throw new Error("Could not find Chrome on your computer. Please install Google Chrome.");
      }
      
    } else {
      // 2. إذا كنا على Linux (Hostinger Cloud / Server)
      console.log("[whatsapp] Detected Server Environment (Linux/Cloud).");
      
      // نجبر المكتبة على تحميل الرسومات في حال كانت ناقصة
      await chromium.font("https://raw.githack.com/googlefonts/noto-emoji/main/fonts/NotoColorEmoji.ttf");
      executablePath = await chromium.executablePath();
    }

    console.log("[whatsapp] Using Chrome at:", executablePath);

    // إعدادات Puppeteer
    const puppeteerOptions = {
      args: os.platform() === "win32" ? [] : [
          ...chromium.args,
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu"
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: os.platform() === "win32" ? false : chromium.headless, // محلياً يفتح المتصفح لتراه، وفي السيرفر يخفيه
      ignoreHTTPSErrors: true,
    };

    const dataPath = path.join(process.cwd(), ".wwebjs_auth");

    client = new Client({
      authStrategy: new LocalAuth({ clientId: "school-notify", dataPath }),
      puppeteer: puppeteerOptions,
    });

    client.on("qr", (qr) => {
      console.log("[whatsapp] QR Code Received:");
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      console.log("[whatsapp] Client is Ready!");
      state.ready = true;
    });

    client.on("authenticated", () => {
        console.log("[whatsapp] Client Authenticated");
    });

    // إضافة معالجة الأخطاء لمنع توقف السيرفر
    client.on("remote_session_saved", () => console.log("[whatsapp] Session Saved"));
    
    await client.initialize();
    return client;

  } catch (err) {
    console.error("[whatsapp] FATAL ERROR:", err.message);
    // لا نوقف السيرفر، بل نسجل الخطأ فقط
    state.lastDisconnect = err.message;
  }
}

// ... باقي الدوال كما هي (getClient, etc)
module.exports = { initWhatsApp };