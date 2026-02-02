const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const { logger } = require("../../utils/logger");

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
    else logger.warn("[whatsapp] PUPPETEER_EXECUTABLE_PATH is set but file not found: %s", execPath);
  }

  logger.info("[whatsapp] initializing", {
    headless,
    executablePath: puppeteerOptions.executablePath,
    timeout: navTimeoutMs
  });

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
    logger.info("[whatsapp] QR received (len=%d)", String(qr || "").length);
    qrcode.generate(qr, { small: true });
  });

  client.on("authenticated", () => {
    logger.info("[whatsapp] client authenticated");
  });

  client.on("ready", () => {
    state.ready = true;
    state.lastQr = null;
    state.lastDisconnect = null;
    logger.info("[whatsapp] client ready");
  });

  client.on("disconnected", (reason) => {
    state.ready = false;
    state.lastDisconnect = reason;
    logger.warn("[whatsapp] disconnected: %s", reason);
    // Don't call client.logout() to avoid file locking issues on Windows
    scheduleReset();
  });

  client.on("auth_failure", (msg) => {
    state.ready = false;
    state.lastDisconnect = `auth_failure: ${msg}`;
    logger.error("[whatsapp] auth_failure: %s", msg);
    scheduleReset();
  });

  client.initialize().catch((err) => {
    state.ready = false;
    state.lastDisconnect = err?.message || String(err);
    logger.error("[whatsapp] initialize failed: %s", err?.message || err);
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
  logger.info("[whatsapp] starting client reset");
  try {
    if (client) {
      try {
        await client.destroy();
        logger.info("[whatsapp] client destroyed successfully");
      } catch (err) {
        logger.error("[whatsapp] error destroying client: %s", err?.message || err);
      }
    }
  } finally {
    client = null;
    state.ready = false;
    state.lastQr = null;
    state.lastDisconnect = "reset";

    // Crucial: Wait a bit for file handles to be released on Windows
    logger.info("[whatsapp] waiting 2s before re-init...");
    setTimeout(() => {
      try {
        initWhatsApp();
      } catch (err) {
        logger.error("[whatsapp] init after reset failed: %s", err?.message || err);
      }
    }, 2000);
  }
}

async function fullResetClient() {
  logger.info("[whatsapp] starting FULL reset (deleting session)");
  try {
    if (client) {
      try {
        await client.destroy();
        logger.info("[whatsapp] client destroyed for full reset");
      } catch (err) {
        logger.error("[whatsapp] error destroying client during full reset: %s", err?.message || err);
      }
    }
  } finally {
    client = null;
    state.ready = false;
    state.lastQr = null;
    state.lastDisconnect = "full_reset";

    // Wait for process to settle
    await new Promise(resolve => setTimeout(resolve, 3000));

    const authPath = path.join(process.cwd(), ".wwebjs_auth");
    const cachePath = path.join(process.cwd(), ".wwebjs_cache");

    const deleteWithRetry = (dirPath, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            logger.info("[whatsapp] deleted directory: %s", dirPath);
          }
          return true;
        } catch (err) {
          if (i === retries - 1) {
            logger.error("[whatsapp] failed to delete %s after %d retries: %s", dirPath, retries, err.message);
            return false;
          }
          logger.warn("[whatsapp] delete attempt %d failed for %s, retrying in 2s...", i + 1, dirPath);
          // Use synchronous sleep for simplicity in this loop or just continue
          // But it's better to wait
        }
      }
      return false;
    };

    deleteWithRetry(authPath);
    deleteWithRetry(cachePath);

    logger.info("[whatsapp] re-initializing after full reset in 1s...");
    setTimeout(() => {
      try {
        initWhatsApp();
      } catch (err) {
        logger.error("[whatsapp] init after full reset failed: %s", err?.message || err);
      }
    }, 1000);
  }
}

let _lastReset = 0;
function scheduleReset() {
  const now = Date.now();
  if (now - _lastReset < 10000) {
    logger.info("[whatsapp] skipping scheduleReset (too soon)");
    return;
  }
  _lastReset = now;
  logger.info("[whatsapp] scheduling client reset in 5s");
  setTimeout(() => {
    resetClient().catch((e) => logger.error("[whatsapp] resetClient error: %s", e?.message || e));
  }, 5000);
}

module.exports = { initWhatsApp, getClient, getState, resetClient, fullResetClient };
