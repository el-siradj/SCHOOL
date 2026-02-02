const cors = require("cors");
const { logger } = require("../utils/logger");

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsMiddleware() {
  const origins = parseList(process.env.CORS_ORIGINS);
  if (process.env.NODE_ENV === "development" && !origins.includes("http://127.0.0.1:5173")) {
    origins.push("http://127.0.0.1:5173");
  }
  const allowAll = process.env.CORS_ALLOW_ALL === "true" || origins.length === 0;

  const methods = parseList(process.env.CORS_METHODS);
  const allowedHeaders = parseList(process.env.CORS_HEADERS);
  const credentials = typeof process.env.CORS_CREDENTIALS !== "undefined"
    ? process.env.CORS_CREDENTIALS === "true"
    : true; // keep existing default true

  return cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // allow curl/postman/mobile apps or same-origin requests from tools
      if (allowAll) return cb(null, true);
      const ok = origins.includes(origin);
      if (!ok) {
        logger.warn(`CORS Rejecting origin: ${origin}. Allowed: ${origins.join(", ")}`);
      }
      return cb(ok ? null : new Error("CORS: Origin not allowed"), ok);
    },
    credentials,
    methods: methods.length > 0 ? methods : undefined,
    allowedHeaders: allowedHeaders.length > 0 ? allowedHeaders : undefined,
  });
}

module.exports = { corsMiddleware };
