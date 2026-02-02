const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const util = require("util");
const { logger } = require("../../utils/logger");

let client;
let state = { ready: false, lastQr: null, lastDisconnect: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeErrObject(err) {
  if (!err) return { message: "unknown error" };
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
}

function initWhatsApp() {
  if (client) return client;

  const headlessEnv = String(process.env.WHATSAPP_HEADLESS ?? "true").toLowerCase();
  const headless = !["0", "false", "no"].includes(headlessEnv);

  const navTimeoutMs = Math.max(15000, Number(process.env.WHATSAPP_NAV_TIMEOUT_MS || 60000));

  // Explicit auth storage dir (must be writable on hosting)
  const dataPath = path.join(process.cwd(), ".wwebjs_auth");
  try {
    fs.mkdirSync(dataPath, { recursive: true });
  } catch (e) {
    logger.warn("[whatsapp] cannot create auth dir %s: %s", dataPath, e?.message || e);
  }

  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH
    ? String(process.env.PUPPETEER_EXECUTABLE_PATH)
    : undefined;

  const execExists = execPath ? fs.existsSync(execPath) : false;

  // Puppeteer options (important on shared/managed hosting)
  const puppeteerOptions = {
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--disable-gpu",
    ],
  };

  if (execPath) {
    if (execExists) puppeteerOptions.executablePath = execPath;
    else logger.warn("[whatsapp] PUPPETEER_EXECUTABLE_PATH is set but file not found: %s", execPath);
  }

  logger.info("[whatsapp] initializing", {
    headless,
    executablePath: puppeteerOptions.executablePath,
    timeout: navTimeoutMs,
    dataPath,
  });

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
    try {
      qrcode.generate(qr, { small: true });
    } catch (e) {
      logger.warn("[whatsapp] qrcode-terminal failed: %s", e?.message || e);
    }
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
    scheduleReset();
  });

  client.on("auth_failure", (msg) => {
    state.ready = false;
    state.lastDisconnect = `auth_failure: ${msg}`;
    logger.error("[whatsapp] auth_failure: %s", msg);
    scheduleReset();
  });

  // IMPORTANT: do NOT JSON.stringify(err) (it becomes {})
  client.initialize().catch((err) => {
    state.ready = false;
    state.lastDisconnect = err?.message || String(err);

    const eobj = safeErrObject(err);
    logger.error(eobj, "[whatsapp] initialize failed");
    // Extra debug (sometimes loggers truncate):
    logger.error("[whatsapp] initialize failed (inspect): %s", util.inspect(err, { depth: 5 }));

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
        logger.error(safeErrObject(err), "[whatsapp] error destroying client");
      }
    }
  } finally {
    client = null;
    state.ready = false;
    state.lastQr = null;
    state.lastDisconnect = "reset";

    // Small delay to release handles
    logger.info("[whatsapp] waiting 2s before re-init...");
    setTimeout(() => {
      try {
        initWhatsApp();
      } catch (err) {
        logger.error(safeErrObject(err), "[whatsapp] init after reset failed");
      }
    }, 2000);
  }
}

async function fullResetClient() {
  logger.info("[whatsapp] starting FULL reset (deleting session)");

  // Step 1: Destroy client
  try {
    if (client) {
      try {
        logger.info("[whatsapp] destroying client...");
        await client.destroy();
        logger.info("[whatsapp] client destroyed for full reset");
      } catch (err) {
        logger.error(safeErrObject(err), "[whatsapp] error destroying client during full reset");
      }
    }
  } finally {
    client = null;
    state.ready = false;
    state.lastQr = null;
    state.lastDisconnect = "full_reset";
  }

  // Step 2: Wait for file handles to be released (especially Windows)
  logger.info("[whatsapp] waiting 5s for file handles to release...");
  await sleep(5000);

  // Step 3: Delete session directories
  const authPath = path.join(process.cwd(), ".wwebjs_auth");
  const cachePath = path.join(process.cwd(), ".wwebjs_cache");

  const deleteWithRetry = async (dirPath, retries = 5) => {
    for (let i = 0; i < retries; i++) {
      try {
        if (!fs.existsSync(dirPath)) {
          logger.info("[whatsapp] directory does not exist: %s", dirPath);
          return true;
        }

        logger.info("[whatsapp] attempting to delete: %s (attempt %d/%d)", dirPath, i + 1, retries);

        // Prefer fs.rmSync for compatibility
        fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });

        logger.info("[whatsapp] successfully deleted: %s", dirPath);
        return true;
      } catch (err) {
        logger.warn(
          "[whatsapp] delete attempt %d/%d failed for %s: %s",
          i + 1,
          retries,
          dirPath,
          err?.message || err
        );

        if (i < retries - 1) {
          const waitMs = (i + 1) * 2000;
          logger.info("[whatsapp] waiting %dms before retry...", waitMs);
          await sleep(waitMs);
        } else {
          logger.error("[whatsapp] failed to delete %s after %d attempts: %s", dirPath, retries, err?.message || err);
          logger.warn("[whatsapp] continuing with initialization despite deletion failure...");
          return false;
        }
      }
    }
    return false;
  };

  const authDeleted = await deleteWithRetry(authPath);
  const cacheDeleted = await deleteWithRetry(cachePath);

  if (authDeleted && cacheDeleted) logger.info("[whatsapp] all session files deleted successfully");
  else logger.warn("[whatsapp] some session files could not be deleted, but continuing...");

  // Step 4: Re-initialize
  logger.info("[whatsapp] re-initializing after full reset in 2s...");
  setTimeout(() => {
    try {
      initWhatsApp();
      logger.info("[whatsapp] re-initialization started successfully");
    } catch (err) {
      logger.error(safeErrObject(err), "[whatsapp] init after full reset failed");
    }
  }, 2000);
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
    resetClient().catch((e) => logger.error(safeErrObject(e), "[whatsapp] resetClient error"));
  }, 5000);
}

module.exports = { initWhatsApp, getClient, getState, resetClient, fullResetClient };
