const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/timetableController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");

// Planner & slot management
router.get("/planner/class/:classId", authRequired, allowDirectorOr("ADMIN","DIRECTOR", "TIMETABLE_OFFICER"), ah(c.getPlannerForClass));
router.get("/planner/suggestions", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "TIMETABLE_OFFICER"), ah(c.getSuggestions));
router.post("/planner/autofill/class/:classId", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "TIMETABLE_OFFICER"), ah(c.autofillClass));


router.post("/slots", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "TIMETABLE_OFFICER"), ah(c.createSlot));
router.delete("/slots/:id", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "TIMETABLE_OFFICER"), ah(c.deleteSlot));
router.delete("/planner/class/:classId/slots", authRequired, allowDirectorOr("ADMIN", "DIRECTOR", "TIMETABLE_OFFICER"), ah(c.deleteAllClassSlots));

module.exports = router;
