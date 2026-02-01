const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/timetableAdminController");
const { authRequired, requireRole, allowDirectorOr } = require("../middleware/auth");

// Admin endpoints for timetable setup
router.get("/subjects", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.listSubjects));
router.post("/subjects", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.createSubject));
router.put("/subjects/:id", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.updateSubject));
router.delete("/subjects/:id", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.deleteSubject));

router.get("/levels", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.listLevels));
router.get("/level-subjects", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getLevelSubjects));
router.put("/level-subjects", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.saveLevelSubjects));

router.get("/teachers/:id/subjects", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getTeacherSubjects));
router.put("/teachers/:id/subjects", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.saveTeacherSubjects));
router.get("/teachers/:id/classes", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getTeacherClasses));
router.put("/teachers/:id/classes", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.saveTeacherClasses));
router.get("/teachers/:id/availability", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getTeacherAvailability));
router.put("/teachers/:id/availability", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.saveTeacherAvailability));
router.get("/teachers/:id/assigned-slots", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getTeacherAssignedSlots));

// Timetable view & print
router.get("/class/:classId/view", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getClassTimetableView));
router.get("/class/:classId/pdf", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.generateClassTimetablePDF));
router.get("/class/:classId/schedule", authRequired, ah(c.getClassSchedule));
router.get("/teacher/:teacherId/view", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getTeacherTimetableView));
router.get("/teacher/:teacherId/pdf", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.generateTeacherTimetablePDF));

// Educational Structure (البنية التربوية)
router.get("/educational-structure", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getEducationalStructure));

// Teacher Assignments Overview (إسنادات الأساتذة)
router.get("/teacher-assignments", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.getTeacherAssignments));

module.exports = router;
