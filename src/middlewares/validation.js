/**
 * Request Validation Middleware (Enhanced)
 * Centralized Joi validation with consistent errors
 */

const Joi = require("joi");

/**
 * Helpers
 */
const cleanJoiMessage = (msg = "") =>
  msg.replace(/"/g, "").replace(/\s+/g, " ").trim();

/**
 * Base Joi options by source
 */
const defaultOptionsBySource = {
  body: {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  },
  params: {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  },
  query: {
    abortEarly: false,
    stripUnknown: true, // تقدر تخليها false إذا كتحتاج بارامترات إضافية
    convert: true,
  },
};

/**
 * Common validation schemas
 */
const schemas = {
  // ID
  id: Joi.number().integer().positive().required().messages({
    "number.base": "المعرف يجب أن يكون رقماً",
    "number.integer": "المعرف يجب أن يكون رقماً صحيحاً",
    "number.positive": "المعرف يجب أن يكون موجباً",
    "any.required": "المعرف مطلوب",
  }),

  // Email (required & optional)
  emailRequired: Joi.string().email().trim().lowercase().required().messages({
    "string.email": "البريد الإلكتروني غير صحيح",
    "any.required": "البريد الإلكتروني مطلوب",
  }),
  emailOptional: Joi.string().email().trim().lowercase().allow(null, "").messages({
    "string.email": "البريد الإلكتروني غير صحيح",
  }),

  // Password
  password: Joi.string().min(6).max(100).required().messages({
    "string.min": "كلمة السر يجب أن تكون 6 أحرف على الأقل",
    "string.max": "كلمة السر طويلة جداً",
    "any.required": "كلمة السر مطلوبة",
  }),

  // Arabic name (expanded a bit: arabic letters + spaces + hamza variants + diacritics + tatweel)
  arabicName: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s\u0640\u0610-\u061A\u064B-\u065F]+$/)
    .required()
    .messages({
      "string.min": "الاسم قصير جداً",
      "string.max": "الاسم طويل جداً",
      "string.pattern.base": "الاسم يجب أن يكون بالعربية فقط",
      "any.required": "الاسم مطلوب",
    }),

  // Arabic or French name (for teachers)
  teacherName: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s\u0640\u0610-\u061A\u064B-\u065Fa-zA-ZÀ-ſ\-']+$/)
    .required()
    .messages({
      "string.min": "الاسم قصير جداً",
      "string.max": "الاسم طويل جداً",
      "string.pattern.base": "الاسم يجب أن يحتوي على أحرف عربية أو فرنسية فقط",
      "any.required": "الاسم مطلوب",
    }),

  // Moroccan phone
  phone: Joi.string()
    .pattern(/^(0|\+212)[5-7]\d{8}$/)
    .allow(null, "")
    .messages({
      "string.pattern.base": "رقم الهاتف غير صحيح (يجب أن يكون رقم مغربي صحيح)",
    }),

  // Massar code
  massarCode: Joi.string()
    .length(10)
    .pattern(/^[A-Z0-9]+$/)
    .messages({
      "string.length": "رقم مسار يجب أن يكون 10 أحرف",
      "string.pattern.base": "رقم مسار يجب أن يحتوي على أحرف إنجليزية كبيرة وأرقام فقط",
    }),

  // ISO date string (recommended for APIs)
  isoDate: Joi.string().isoDate().messages({
    "string.isoDate": "صيغة التاريخ غير صحيحة (يجب أن تكون ISO مثل 2026-02-01)",
  }),

  // Pagination
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),

  // Gender
  gender: Joi.string().valid("MALE", "FEMALE").messages({
    "any.only": "الجنس يجب أن يكون ذكر أو أنثى",
  }),

  // Student status
  studentStatus: Joi.string()
    .valid("STUDYING", "INCOMING", "REFERRED", "ADDED", "DELETED", "NOT_ENROLLED", "LEFT", "DROPPED")
    .messages({
      "any.only": "حالة التلميذ غير صحيحة",
    }),

  // Role
  userRole: Joi.string().valid("ADMIN", "DIRECTOR", "ABSENCE_OFFICER", "TIMETABLE_OFFICER").messages({
    "any.only": "الدور يجب أن يكون أحد القيم المسموحة",
  }),

  // Absence type
  absenceType: Joi.string().valid("JUSTIFIED", "UNJUSTIFIED").messages({
    "any.only": "نوع الغياب يجب أن يكون مبرر أو غير مبرر",
  }),
};

/**
 * Student validation schemas
 */
const studentSchemas = {
  create: Joi.object({
    massar_code: schemas.massarCode.required(),
    full_name: schemas.arabicName,
    class_number: Joi.number().integer().positive().allow(null),
    class_id: schemas.id.allow(null),
    gender: schemas.gender.required(),
    date_of_birth: schemas.isoDate.allow(null, ""),
    parent_phone: schemas.phone,
    mother_phone: schemas.phone,
    guardian_phone: schemas.phone,
    status: schemas.studentStatus.default("STUDYING"),
  }),

  update: Joi.object({
    massar_code: schemas.massarCode,
    full_name: schemas.arabicName,
    class_number: Joi.number().integer().positive().allow(null, ""),
    class_id: Joi.number().integer().positive().allow(null, ""),
    gender: schemas.gender.allow(null, ""),
    date_of_birth: schemas.isoDate.allow(null, ""),
    level: Joi.string().max(50).allow(null, ""),
    class_name: Joi.string().max(100).allow(null, ""),
    parent_phone: schemas.phone,
    father_phone: schemas.phone,
    mother_phone: schemas.phone,
    guardian_phone: schemas.phone,
    status: schemas.studentStatus,
  }),

  query: Joi.object({
    page: schemas.page,
    limit: schemas.limit,
    level: Joi.string().allow("", null),
    class: Joi.string().allow("", null),
    class_name: Joi.string().allow("", null),
    status: Joi.string().allow("", null),
    gender: schemas.gender.allow("", null),
    q: Joi.string().max(100).allow("", null),
    group: Joi.string().allow("", null),
    month: Joi.string().pattern(/^\d{4}-\d{2}$/).allow("", null),
  }).unknown(true),
};

/**
 * Teacher validation schemas
 */
const teacherSchemas = {
  create: Joi.object({
    full_name: schemas.teacherName,
    Code_CIN: Joi.string().min(5).max(20).required().messages({
      "string.min": "رقم البطاقة قصير جداً",
      "any.required": "رقم البطاقة مطلوب",
    }),
    gender: schemas.gender.required(),
    phone: schemas.phone,
    email: schemas.emailOptional,
  }),

  update: Joi.object({
    full_name: Joi.string()
      .min(2)
      .max(100)
      .pattern(/^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s\u0640\u0610-\u061A\u064B-\u065Fa-zA-ZÀ-ſ\-']+$/)
      .messages({
        "string.min": "الاسم قصير جداً",
        "string.max": "الاسم طويل جداً",
        "string.pattern.base": "الاسم يجب أن يحتوي على أحرف عربية أو فرنسية فقط",
      }),
    Code_CIN: Joi.string().min(5).max(20),
    gender: schemas.gender.allow("", null),
    phone: schemas.phone,
    email: schemas.emailOptional,
  }),

  query: Joi.object({
    page: schemas.page,
    limit: schemas.limit,
    gender: schemas.gender.allow("", null),
    q: Joi.string().max(100).allow("", null),
    all: Joi.string().valid("true", "1", "false", "0").allow("", null),
    matiere: Joi.string().max(100).allow("", null),
  }).unknown(true),
};

/**
 * User validation schemas
 */
const userSchemas = {
  create: Joi.object({
    full_name: Joi.string().min(2).max(100).required().messages({
      "string.min": "الاسم قصير جداً",
      "any.required": "الاسم مطلوب",
    }),
    email: schemas.emailRequired,
    password: schemas.password,
    role: schemas.userRole.default("USER"),
    avatar_url: Joi.string().uri().allow(null, ""),
  }),

  update: Joi.object({
    full_name: Joi.string().min(2).max(100),
    email: schemas.emailOptional, // فـ update خليه optional
    role: schemas.userRole,
    is_active: Joi.boolean(),
    avatar_url: Joi.string().uri().allow(null, ""),
  }),

  changePassword: Joi.object({
    current_password: schemas.password.required().messages({
      "any.required": "كلمة السر الحالية مطلوبة",
    }),
    new_password: Joi.string().min(6).max(100).required().messages({
      "string.min": "كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل",
      "string.max": "كلمة السر الجديدة طويلة جداً",
      "any.required": "كلمة السر الجديدة مطلوبة",
    }),
  }),

  // Schema for admin resetting another user's password
  resetPassword: Joi.object({
    password: schemas.password.required().messages({
      "any.required": "كلمة السر مطلوبة",
    }),
  }),
};

/**
 * Absence validation schemas
 */
const absenceSchemas = {
  create: Joi.object({
    student_id: schemas.id,
    absence_date: schemas.isoDate.required(),
    period_number: Joi.number().integer().min(1).max(8).required().messages({
      "number.min": "رقم الحصة يجب أن يكون بين 1 و 8",
      "number.max": "رقم الحصة يجب أن يكون بين 1 و 8",
      "any.required": "رقم الحصة مطلوب",
    }),
    absence_type: schemas.absenceType.default("UNJUSTIFIED"),
    section: Joi.string().max(50).allow(null, ""),
    notes: Joi.string().max(500).allow(null, ""),
  }),

  query: Joi.object({
    page: schemas.page,
    limit: schemas.limit,
    date: Joi.string().allow("", null),
    start_date: Joi.string().allow("", null),
    end_date: Joi.string().allow("", null),
    section: Joi.string().allow("", null),
    level: Joi.string().allow("", null),
    class: Joi.string().allow("", null),
    class_name: Joi.string().allow("", null),
    period_number: Joi.number().integer().min(1).max(8).allow("", null),
    student_id: Joi.number().integer().positive().allow("", null),
    group: Joi.string().allow("", null),
    month: Joi.string().pattern(/^\d{4}-\d{2}$/).allow("", null),
    status: Joi.string().allow("", null),
    absence_type: Joi.string().allow("", null),
    distinct_students: Joi.string().allow("", null),
  }).unknown(true),

  stats: Joi.object({}).unknown(true),

  table: Joi.object({
    date: Joi.string().required(),
    section: Joi.string().max(50).required(),
    include_inactive: Joi.string().allow("", null),
  }).unknown(true),
};

/**
 * Campaign validation schemas
 */
const campaignSchemas = {
  create: Joi.object({
    audience: Joi.string().valid("STUDENTS", "TEACHERS").required().messages({
      "any.only": "الفئة المستهدفة يجب أن تكون تلاميذ أو أساتذة",
      "any.required": "الفئة المستهدفة مطلوبة",
    }),
    mode: Joi.string().valid("GENERAL", "ABSENCE").required().messages({
      "any.only": "نوع الحملة يجب أن يكون عام أو غياب",
      "any.required": "نوع الحملة مطلوب",
    }),
    message_body: Joi.string().min(1).max(1000).required().messages({
      "string.min": "نص الرسالة مطلوب",
      "string.max": "نص الرسالة طويل جداً (الحد الأقصى 1000 حرف)",
      "any.required": "نص الرسالة مطلوب",
    }),
    media_path: Joi.string().allow(null, "").optional(),
    ids: Joi.array().items(schemas.id).min(1).required().messages({
      "array.min": "يجب اختيار مستلم واحد على الأقل",
      "any.required": "قائمة المستلمين مطلوبة",
    }),
    student_targets: Joi.array()
      .items(Joi.string().valid("FATHER", "MOTHER", "GUARDIAN"))
      .when("audience", {
        is: "STUDENTS",
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      }),
    filter_json: Joi.object().allow(null),
  }),
};

/**
 * Validation middleware factory
 * @param {Object} schema - Joi schema
 * @param {'body'|'query'|'params'} source
 * @param {Object} customOptions - override options
 */
function validate(schema, source = "body", customOptions = {}) {
  return (req, res, next) => {
    const dataToValidate = req[source];

    const options = {
      ...defaultOptionsBySource[source],
      ...customOptions,
    };

    const { error, value } = schema.validate(dataToValidate, options);

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        code: detail.type,
        message: cleanJoiMessage(detail.message),
      }));

      // إظهار أول رسالة خطأ محددة بدلاً من الرسالة العامة
      const mainMessage = errors.length > 0 ? errors[0].message : "خطأ في البيانات المدخلة";

      return res.status(400).json({
        success: false,
        message: mainMessage,
        errors,
      });
    }

    req[source] = value;
    next();
  };
}

/**
 * Validate ID param
 */
function validateId(paramName = "id") {
  return validate(Joi.object({ [paramName]: schemas.id }), "params");
}

module.exports = {
  schemas,
  studentSchemas,
  teacherSchemas,
  userSchemas,
  absenceSchemas,
  campaignSchemas,
  validate,
  validateId,
};
