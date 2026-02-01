/**
 * Logging System using Winston
 * Professional logging with different levels and transports
 */

const winston = require("winston");
const path = require("path");

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "blue",
};

// Add colors to winston
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(
    (info) => `${info.timestamp} [${info.level}]: ${info.message}${info.stack ? "\n" + info.stack : ""}`
  )
);

// Define transports
const transports = [];

// Console transport (always active in development)
if (process.env.NODE_ENV !== "production") {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// File transports (always active)
const logsDir = process.env.LOGS_DIR || path.join(__dirname, "..", "..", "logs");

// All logs
transports.push(
  new winston.transports.File({
    filename: path.join(logsDir, "combined.log"),
    format,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  })
);

// Error logs
transports.push(
  new winston.transports.File({
    filename: path.join(logsDir, "error.log"),
    level: "error",
    format,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  })
);

// HTTP logs (if enabled)
if (process.env.LOG_HTTP !== "0") {
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, "http.log"),
      level: "http",
      format,
      maxsize: 5242880, // 5MB
      maxFiles: 3,
    })
  );
}

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  levels,
  format,
  transports,
  exitOnError: false,
});

/**
 * Log HTTP requests
 */
logger.http = (message, meta = {}) => {
  logger.log("http", message, meta);
};

/**
 * Log info messages
 */
logger.info = (message, meta = {}) => {
  logger.log("info", message, meta);
};

/**
 * Log warning messages
 */
logger.warn = (message, meta = {}) => {
  logger.log("warn", message, meta);
};

/**
 * Log error messages
 */
logger.error = (message, error = null, meta = {}) => {
  if (error instanceof Error) {
    logger.log("error", message, {
      ...meta,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });
  } else {
    logger.log("error", message, meta);
  }
};

/**
 * Log debug messages
 */
logger.debug = (message, meta = {}) => {
  logger.log("debug", message, meta);
};

/**
 * Log database queries (if debug enabled)
 */
logger.query = (sql, params = [], duration = 0) => {
  if (process.env.LOG_QUERIES === "1") {
    logger.debug("Database Query", {
      sql: sql.substring(0, 500), // Limit SQL length
      params: params.length > 10 ? `${params.length} params` : params,
      duration: `${duration}ms`,
    });
  }
};

/**
 * Log authentication events
 */
logger.auth = (action, userId, meta = {}) => {
  logger.info(`Auth: ${action}`, {
    userId,
    ...meta,
  });
};

/**
 * Log campaign events
 */
logger.campaign = (action, campaignId, meta = {}) => {
  logger.info(`Campaign: ${action}`, {
    campaignId,
    ...meta,
  });
};

/**
 * Log security events
 */
logger.security = (event, meta = {}) => {
  logger.warn(`Security: ${event}`, meta);
};

/**
 * Express middleware for HTTP logging
 */
function httpLogger(req, res, next) {
  const start = Date.now();

  // Log request
  logger.http(`${req.method} ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.id,
  });

  // Log response
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? "warn" : "http";

    logger.log(level, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      requestId: req.id,
    });
  });

  next();
}

/**
 * Create logs directory if it doesn't exist
 */
const fs = require("fs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  logger.info("Logs directory created", { path: logsDir });
}

module.exports = {
  logger,
  httpLogger,
};
