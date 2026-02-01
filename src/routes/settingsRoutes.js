const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/settingsController");
const { authRequired, requireRole } = require("../middleware/auth");
const upload = require("../middleware/upload");

router.get("/public", ah(c.public));

router.get("/timetable/day-status", authRequired, ah(c.getDayStatus));

router.get("/timetable/study-periods/status", authRequired, ah(c.getStudyPeriodsStatus));

// Active classes list for operational screens (absences, etc.)
router.get("/timetable/classes/active", authRequired, ah(c.listActiveTimetableClasses));

router.get("/", authRequired, ah(c.get));
router.put("/", authRequired, ah(c.update));
router.put("/logo", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), upload.single("file"), ah(c.updateLogo));

router.get("/timetable/days", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.listTimetableDays));
router.post("/timetable/days", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.createTimetableDay));
router.put("/timetable/days/:id", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.updateTimetableDay));
router.delete("/timetable/days/:id", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.deleteTimetableDay));

router.get("/timetable/periods", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.listTimetablePeriods));
router.post("/timetable/periods", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.createTimetablePeriod));
router.put("/timetable/periods/:id", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.updateTimetablePeriod));
router.delete("/timetable/periods/:id", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.deleteTimetablePeriod));

router.get("/timetable/classes", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.listTimetableClasses));
router.post("/timetable/classes", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.createTimetableClass));
router.put("/timetable/classes/:id", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.updateTimetableClass));
router.delete("/timetable/classes/:id", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.deleteTimetableClass));
router.get("/timetable/study-periods", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.listStudyPeriods));
router.put("/timetable/study-periods", authRequired, requireRole("DIRECTOR", "ADMIN", "TIMETABLE_OFFICER"), ah(c.saveStudyPeriods));

module.exports = router;
