/**
 * Security Configuration
 * Enhanced security settings for production environment
 */

const helmet = require("helmet");

/**
 * Get helmet configuration based on environment
 */
function getHelmetConfig() {
  const isDev = process.env.NODE_ENV !== "production";

  return {
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        scriptSrc: isDev ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"] : ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isDev ? null : [],
      },
    },

    // Cross-Origin Resource Policy
    crossOriginResourcePolicy: { 
      policy: isDev ? "cross-origin" : "same-origin" 
    },

    // Cross-Origin Opener Policy
    crossOriginOpenerPolicy: { 
      policy: "same-origin-allow-popups" 
    },

    // DNS Prefetch Control
    dnsPrefetchControl: { allow: false },

    // Frame Guard (Clickjacking protection)
    frameguard: { action: "deny" },

    // Hide Powered By header
    hidePoweredBy: true,

    // HSTS (HTTP Strict Transport Security)
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },

    // IE No Open (IE8+ downloads protection)
    ieNoOpen: true,

    // No Sniff (MIME type sniffing protection)
    noSniff: true,

    // Referrer Policy
    referrerPolicy: { 
      policy: "strict-origin-when-cross-origin" 
    },

    // XSS Filter
    xssFilter: true,
  };
}

/**
 * Security headers middleware
 */
function securityHeaders() {
  return helmet(getHelmetConfig());
}

/**
 * Additional security headers
 */
function additionalSecurityHeaders(req, res, next) {
  // Permissions Policy (formerly Feature Policy)
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()"
  );

  // X-Content-Type-Options
  res.setHeader("X-Content-Type-Options", "nosniff");

  // X-Frame-Options
  res.setHeader("X-Frame-Options", "DENY");

  // X-XSS-Protection
  res.setHeader("X-XSS-Protection", "1; mode=block");

  next();
}

/**
 * Rate limiting configuration
 */
const rateLimitConfig = {
  // General API rate limit
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.RATE_LIMIT_GENERAL || 100, // 100 requests per window
    message: {
      success: false,
      message: "عدد كبير من الطلبات. المرجو المحاولة لاحقاً.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  },

  // Authentication endpoints (stricter)
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.RATE_LIMIT_AUTH || 5, // 5 login attempts per window
    message: {
      success: false,
      message: "عدد كبير من محاولات تسجيل الدخول. المرجو المحاولة بعد 15 دقيقة.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful logins
  },

  // Campaign sending (very strict)
  campaign: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: process.env.RATE_LIMIT_CAMPAIGN || 10, // 10 campaigns per hour
    message: {
      success: false,
      message: "تم الوصول للحد الأقصى من إرسال الحملات في الساعة.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  },

  // File uploads
  upload: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.RATE_LIMIT_UPLOAD || 20, // 20 uploads per window
    message: {
      success: false,
      message: "عدد كبير من عمليات رفع الملفات. المرجو الانتظار.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  },
};

/**
 * CORS configuration (read from environment)
 */
function parseList(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const corsConfig = {
  origin: function (origin, callback) {
    const origins = parseList(process.env.CORS_ORIGINS);
    const allowAll = process.env.CORS_ALLOW_ALL === "true" || origins.length === 0;

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (allowAll) return callback(null, true);

    const ok = origins.includes(origin);
    if (ok || process.env.NODE_ENV !== "production") return callback(null, true);
    return callback(new Error("غير مسموح بالوصول من هذا المصدر"));
  },
  credentials: typeof process.env.CORS_CREDENTIALS !== "undefined" ? process.env.CORS_CREDENTIALS === "true" : true,
  methods: parseList(process.env.CORS_METHODS).length ? parseList(process.env.CORS_METHODS) : ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: parseList(process.env.CORS_HEADERS).length ? parseList(process.env.CORS_HEADERS) : ["Content-Type", "Authorization", "X-Request-ID"],
  exposedHeaders: ["X-Request-ID"],
  maxAge: 86400, // 24 hours
};

/**
 * Input sanitization patterns
 */
const sanitizationPatterns = {
  // SQL injection patterns
  sqlInjection: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|DECLARE)\b)/gi,
  
  // XSS patterns
  xss: /<script[^>]*>.*?<\/script>/gi,
  
  // NoSQL injection patterns
  nosqlInjection: /(\$where|\$ne|\$gt|\$lt|\$regex)/gi,
  
  // Path traversal
  pathTraversal: /(\.\.|\/etc\/|\/var\/|C:\\)/gi,
};

/**
 * Allowed file types for uploads
 */
const allowedFileTypes = {
  images: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  documents: [".pdf", ".doc", ".docx", ".xls", ".xlsx"],
  media: [".mp3", ".mp4", ".wav", ".avi"],
  excel: [".xlsx", ".xls", ".csv"],
};

/**
 * File size limits (in bytes)
 */
const fileSizeLimits = {
  image: 5 * 1024 * 1024, // 5MB
  document: 10 * 1024 * 1024, // 10MB
  media: 50 * 1024 * 1024, // 50MB
  excel: 2 * 1024 * 1024, // 2MB
};

module.exports = {
  securityHeaders,
  additionalSecurityHeaders,
  rateLimitConfig,
  corsConfig,
  sanitizationPatterns,
  allowedFileTypes,
  fileSizeLimits,
  getHelmetConfig,
};
