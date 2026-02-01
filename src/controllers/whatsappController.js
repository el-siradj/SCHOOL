const { getState, resetClient } = require("../services/whatsapp/client");


exports.state = async (req, res) => {
  const st = getState();
  res.json({ ready: st.ready, hasQr: !!st.lastQr, lastDisconnect: st.lastDisconnect || null });
};

exports.qr = async (req, res) => {
  const st = getState();
  res.json({ qr: st.lastQr || null });
};

exports.restart = async (req, res) => {
  await resetClient();
  res.json({ success: true, message: "WhatsApp client restarting..." });
};

