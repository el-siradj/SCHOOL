const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/dashboardController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");

router.get("/overview", authRequired,ah(c.overview));
router.get("/student-mobility", authRequired, ah(c.studentMobility));
router.get("/absence-rate-last7", authRequired, ah(c.absenceRateLast7));

module.exports = router;
