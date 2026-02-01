
const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/absencesController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");
const { validate, validateId, absenceSchemas } = require("../middlewares/validation");

// PDF إشعار غياب عام
router.post("/print-notices", authRequired, allowDirectorOr("ADMIN","dIRECTOR", "ABSENCE_OFFICER"), ah(c.getSimpleAbsenceNoticesPdf));

router.get("/", authRequired, allowDirectorOr("ADMIN", "ABSENCE_OFFICER"), validate(absenceSchemas.query, "query"), ah(c.list));
router.get("/stats", authRequired, allowDirectorOr("ADMIN", "ABSENCE_OFFICER"), validate(absenceSchemas.stats, "query"), ah(c.stats));
router.get("/absent-on-date", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), validate(absenceSchemas.query, "query"), ah(c.getAbsentOnDate));
router.get("/notices/candidates", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), ah(c.getAbsenceNoticeCandidates));
router.post("/notices/pdf", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), ah(c.getAbsenceNoticesPdf));
router.get("/table", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), validate(absenceSchemas.table, "query"), ah(c.getAbsencesTable));

// Student absences
router.get("/student/:studentId/pdf", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), validateId("studentId"), ah(c.getStudentAbsenceCardPdf));
router.post(
  "/student/:studentId/pdf/send",
  authRequired,
  allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"),
  validateId("studentId"),
  ah(c.sendStudentAbsenceCardPdfWhatsApp)
);
router.get("/student/:studentId", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), validateId("studentId"), ah(c.getStudentAbsences));

router.get("/:id", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), validateId("id"), ah(c.getOne));

// Manage absences - DIRECTOR & ADMIN & ABSENCE_OFFICER
router.post("/", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), validate(absenceSchemas.create), ah(c.create));
router.post("/table", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), ah(c.saveAbsencesTable));
router.put("/:id", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), validateId("id"), validate(absenceSchemas.update), ah(c.update));
router.delete("/:id", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "ABSENCE_OFFICER"), validateId("id"), ah(c.remove));

module.exports = router;
