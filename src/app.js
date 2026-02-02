const express = require("express");
const path = require("path");
const compression = require("compression");

const { corsMiddleware } = require("./config/cors");
const { securityHeaders, additionalSecurityHeaders } = require("./config/security");
const { requestId } = require("./middlewares/requestId");
const { generalLimiter, authLimiter } = require("./middlewares/rateLimiters");
const { notFound, errorHandler } = require("./middlewares/errorMiddleware");
const { logger, httpLogger } = require("./utils/logger");

const app = express();

// Trust proxy (needed if you deploy behind reverse proxy)
app.set("trust proxy", 1);

// Request ID (for tracking)
app.use(requestId);

// HTTP Logging (Winston-based)
if (process.env.LOG_HTTP !== "0") {
  app.use(httpLogger);
}

// Security headers (Helmet + custom)
app.use(securityHeaders());
app.use(additionalSecurityHeaders);

// Compression
app.use(compression());

// CORS
app.use(corsMiddleware());

// Rate limiting
app.use(generalLimiter);

// Body parsing
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Log server start
logger.info("Application initialized", {
  environment: process.env.NODE_ENV || "development",
  nodeVersion: process.version,
});

// Serve uploaded files (logos, images, attachments)
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res) => {
      // Avoid ERR_BLOCKED_BY_RESPONSE.NotSameOrigin when frontend runs on a different origin (dev)
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

app.use("/api/auth", authLimiter, require("./routes/authRoutes"));
app.use("/api/templates", require("./routes/templateRoutes"));
app.use("/api/campaigns", require("./routes/campaignRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api/media", require("./routes/mediaRoutes"));
app.use("/api/teachers", require("./routes/teachersRoutes"));

app.use("/api/classes", require("./routes/classesRoutes"));
app.use("/api/students", require("./routes/studentsRoutes"));
app.use("/api/absences", require("./routes/absencesRoutes"));
app.use("/api/import", require("./routes/importRoutes"));
app.use("/api/users", require("./routes/usersRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/timetable-admin", require("./routes/timetableAdminRoutes"));
app.use("/api/timetable", require("./routes/timetableRoutes"));

// Health check endpoint with detailed status
app.get("/api/health", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
  };

  // Check database connection
  try {
    const pool = require("./db");
    await pool.query("SELECT 1");
    health.database = "connected";
  } catch (error) {
    health.database = "disconnected";
    health.status = "degraded";
  }

  // Check WhatsApp status (if enabled)
  if (process.env.WHATSAPP_ENABLED === "true") {
    try {
      const { getState } = require("./services/whatsapp/client");
      const waState = getState();
      health.whatsapp = {
        ready: waState.ready,
        hasQr: !!waState.lastQr,
      };
    } catch (error) {
      health.whatsapp = "unavailable";
    }
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});


// Serve frontend (internal deployment)
// Build frontend: (cd frontend && npm run build) then start backend with NODE_ENV=production
if (process.env.NODE_ENV === "production") {
  const distDir = process.env.FRONTEND_DIST || path.join(__dirname, "..", "..", "frontend", "dist");
  app.use(express.static(distDir));
  // SPA fallback
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
