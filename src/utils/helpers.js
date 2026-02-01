function normStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function normPhone(v) {
  const s = normStr(v);
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned.length ? cleaned : null;
}

function normGender(v) {
  const s = normStr(v).toLowerCase();
  if (!s) return null;
  if (["m", "male", "homme", "ذكر", "ولد"].includes(s)) return "MALE";
  if (["f", "female", "femme", "أنثى", "انثى", "بنت"].includes(s)) return "FEMALE";
  return null;
}

function normStudentStatus(v, fallback = "STUDYING") {
  const s = normStr(v).toUpperCase();
  const allowed = new Set([
    "STUDYING",
    "INCOMING",
    "REFERRED",
    "ADDED",
    "DELETED",
    "NOT_ENROLLED",
    "LEFT",
    "DROPPED",
    "ACTIVE",
    "INACTIVE",
  ]);
  if (allowed.has(s)) return s;

  // Allow Arabic shortcuts from UI/import (best-effort)
  if (s === "متمدرس") return "STUDYING";
  if (s === "وافد") return "INCOMING";
  if (s === "مرجع") return "REFERRED";
  if (s === "مضاف") return "ADDED";
  if (s === "محذوف") return "DELETED";
  if (s === "غير ملتحق") return "NOT_ENROLLED";
  if (s === "مغادر") return "LEFT";
  if (s === "منقطع") return "DROPPED";

  return fallback;
}

function isActiveStatus(status) {
    return ["STUDYING", "INCOMING", "REFERRED", "ADDED"].includes(status);
}

module.exports = {
  normStr,
  normPhone,
  normGender,
  normStudentStatus,
  isActiveStatus,
};
