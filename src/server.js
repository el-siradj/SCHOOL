require("dotenv").config();
const app = require("./app");
const { initWhatsApp } = require("./services/whatsapp/client");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`API running on ${HOST}:${PORT}`);
  const enabledEnv = String(process.env.WHATSAPP_ENABLED ?? "true").toLowerCase();
  const enabled = !["0", "false", "no"].includes(enabledEnv);
  if (enabled) initWhatsApp();
  else console.log("WhatsApp disabled (set WHATSAPP_ENABLED=true to enable).");
});
