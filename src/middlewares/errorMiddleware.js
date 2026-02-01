const { logger } = require("../utils/logger");

function notFound(req, res, next) {
  logger.warn("Route not found", {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });
  
  res.status(404).json({ 
    message: "Not Found", 
    path: req.originalUrl 
  });
}

function errorHandler(err, req, res, next) {
  const status = Number(err.statusCode || err.status || 500);
  const message = err.message || (status === 500 ? "Internal Server Error" : "Error");

  // Determine error type for logging
  const errorType = err.name || "Error";
  const isValidationError = errorType === "ValidationError" || status === 400;
  const isAuthError = status === 401 || status === 403;
  const isServerError = status >= 500;

  // Log based on severity
  if (isServerError) {
    logger.error("Server error", err, {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      userId: req.user?.id,
      body: req.body,
      query: req.query,
      params: req.params,
    });
  } else if (isAuthError) {
    logger.warn("Authentication/Authorization error", {
      status,
      message,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      userId: req.user?.id,
    });
  } else if (isValidationError) {
    logger.info("Validation error", {
      status,
      message,
      method: req.method,
      path: req.originalUrl,
      errors: err.details || err.errors,
    });
  } else {
    logger.warn("Client error", {
      status,
      message,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    });
  }

  // Send response
  res.status(status).json({
    message,
    ...(err.details ? { details: err.details } : {}),
    ...(process.env.NODE_ENV !== "production" && isServerError ? { stack: err.stack } : {}),
  });
}

module.exports = { notFound, errorHandler };
