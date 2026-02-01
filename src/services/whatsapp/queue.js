const path = require("path");
const fs = require("fs");
const { MessageMedia } = require("whatsapp-web.js");
const { getClient, getState } = require("./client");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normPhone(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned.length ? cleaned : null;
}

function toDigitsMorocco(phone) {
  const p = normPhone(phone);
  if (!p) return null;
  const d = p.replace(/[^\d]/g, "");
  if (!d) return null;

  // 0XXXXXXXXX => 212XXXXXXXXX
  if (d.startsWith("0") && d.length >= 10) return "212" + d.slice(1);
  if (d.startsWith("212")) return d;

  return d;
}

function toJid(phoneDigits) {
  return phoneDigits ? `${phoneDigits}@c.us` : null;
}

async function sendOne({ jid, text, mediaPath, mediaBase64, mediaMime, mediaFilename }) {
  const client = getClient();
  const st = getState();
  if (!st.ready) throw new Error("WHATSAPP_NOT_READY");

  const isReg = await client.isRegisteredUser(jid);
  if (!isReg) return { skipped: true, reason: "NUMBER_NOT_ON_WHATSAPP" };

  if (mediaPath) {
    const abs = path.isAbsolute(mediaPath) ? mediaPath : path.join(process.cwd(), mediaPath);
    if (!fs.existsSync(abs)) throw new Error("MEDIA_NOT_FOUND");
    const media = MessageMedia.fromFilePath(abs);
    const msg = await client.sendMessage(jid, media, { caption: text || undefined });
    return { success: true, messageId: msg?.id?._serialized || null };
  }

  if (mediaBase64) {
    const media = new MessageMedia(mediaMime || "application/octet-stream", mediaBase64, mediaFilename || undefined);
    const msg = await client.sendMessage(jid, media, { caption: text || undefined });
    return { success: true, messageId: msg?.id?._serialized || null };
  }

  const msg = await client.sendMessage(jid, text);
  return { success: true, messageId: msg?.id?._serialized || null };
}

module.exports = { sleep, toDigitsMorocco, toJid, sendOne };
