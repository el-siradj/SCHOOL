const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/teachersController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");
const { validate, validateId, teacherSchemas } = require("../middlewares/validation");

router.get("/", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), validate(teacherSchemas.query, "query"), ah(c.list));
router.get("/active", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), ah(c.listActive));
router.get("/:id", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), validateId("id"), ah(c.getOne));

// Manage teachers (create/update/delete) - DIRECTOR & ADMIN only
router.post("/", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), validate(teacherSchemas.create), ah(c.create));
router.put("/:id", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), validateId("id"), validate(teacherSchemas.update), ah(c.update));
router.delete("/:id", authRequired, allowDirectorOr("ADMIN", "TIMETABLE_OFFICER"), validateId("id"), ah(c.remove));

module.exports = router;
