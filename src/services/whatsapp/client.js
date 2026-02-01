const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");

let client;
let state = { ready: false, lastQr: null, lastDisconnect: null };

function initWhatsApp() {
  if (client) return client;

  const headlessEnv = String(process.env.WHATSAPP_HEADLESS ?? "true").toLowerCase();
  const headless = !["0", "false", "no"].includes(headlessEnv);
  const navTimeoutMs = Math.max(15000, Number(process.env.WHATSAPP_NAV_TIMEOUT_MS || 60000));

  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH ? String(process.env.PUPPETEER_EXECUTABLE_PATH) : undefined;
  const execExists = execPath ? fs.existsSync(execPath) : false;

  // Puppeteer options
  const puppeteerOptions = {
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
  if (execPath) {
    if (execExists) puppeteerOptions.executablePath = execPath;
    else console.warn("[whatsapp] PUPPETEER_EXECUTABLE_PATH is set but file not found:", execPath);
  }

  console.log("[whatsapp] initializing with puppeteer options:", { headless, puppeteerExecutable: puppeteerOptions.executablePath ? puppeteerOptions.executablePath : null, puppeteerTimeout: navTimeoutMs });

  // Use explicit dataPath so we know where LocalAuth stores sessions
  const dataPath = path.join(process.cwd(), ".wwebjs_auth");
  client = new Client({
    authStrategy: new LocalAuth({ clientId: "school-notify", dataPath }),
    puppeteer: puppeteerOptions,
    puppeteerTimeout: navTimeoutMs,
  });

  client.on("qr", (qr) => {
    state.lastQr = qr;
    state.ready = false;
    state.lastDisconnect = null;
    console.log("[whatsapp] QR received (len=", String(qr || "").length, ")");
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
    // Don't call client.logout() to avoid file locking issues on Windows
    scheduleReset();
  });

  client.on("auth_failure", (msg) => {
    state.ready = false;
    state.lastDisconnect = `auth_failure: ${msg}`;
    console.error("[whatsapp] auth_failure:", msg);
    scheduleReset();
  });

  client.initialize().catch((err) => {
    state.ready = false;
    state.lastDisconnect = err?.message || String(err);
    console.error("[whatsapp] initialize failed:", err?.message || err);
    scheduleReset();
  });
  return client;
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
      // attempt graceful shutdown
      try {
        await client.destroy();
      } catch (err) {
        console.error("[whatsapp] error destroying client:", err?.message || err);
      }
    }
  } finally {
    client = null;
    // preserve same state object reference but reset fields
    state.ready = false;
    state.lastQr = null;
    state.lastDisconnect = "reset";
    // re-init in background (don't await long-running initialize)
    try {
      initWhatsApp();
    } catch (err) {
      console.error("[whatsapp] init after reset failed:", err?.message || err);
    }
  }
}

let _lastReset = 0;
function scheduleReset() {
  const now = Date.now();
  // avoid rapid reset loops: minimum 5s between resets
  if (now - _lastReset < 5000) return;
  _lastReset = now;
  console.log("[whatsapp] scheduling client reset in 2s");
  setTimeout(() => {
    resetClient().catch((e) => console.error("[whatsapp] resetClient error:", e?.message || e));
  }, 2000);
}

module.exports = { initWhatsApp, getClient, getState, resetClient };
