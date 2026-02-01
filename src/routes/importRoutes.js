const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const excelUpload = require("../middleware/excelUpload");
const c = require("../controllers/importController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");

router.post("/students", authRequired, allowDirectorOr("ADMIN","DIRECTOR"), excelUpload.single("file"), ah(c.importStudents));
router.post("/students/finalize", authRequired, allowDirectorOr("ADMIN","DIRECTOR"), ah(c.finalizeImportedStudents));
router.post(
  "/students-passmassar",
  authRequired,
  allowDirectorOr("ADMIN","DIRECTOR"),
  excelUpload.single("file"),
  ah(c.importStudentsPassMassar)
);
router.post("/teachers", authRequired, allowDirectorOr("ADMIN","DIRECTOR", "TIMETABLE_OFFICER"), excelUpload.single("file"), ah(c.importTeachers));

module.exports = router;
