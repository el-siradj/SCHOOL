const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const upload = require("../middleware/upload");
const c = require("../controllers/mediaController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");

router.post(
  "/upload",
  authRequired,
  allowDirectorOr("ADMIN", "ABSENCE_OFFICER", "TIMETABLE_OFFICER","DIRECTOR"),
  upload.single("file"),
  ah(c.uploadMedia)
);

module.exports = router;
