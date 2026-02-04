const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/studentsController");
const pass = require("../controllers/passMassarController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");
const { validate, validateId, studentSchemas } = require("../middlewares/validation");

router.get("/pass-massar", authRequired,  ah(pass.list));
router.get("/pass-massar/pdf", authRequired,  ah(pass.pdfList));
router.get("/:id/pass-massar/pdf", authRequired,  ah(pass.pdfOne));

router.get("/stats/pdf", authRequired, ah(c.statsPdf));
router.get("/stats", authRequired, validate(studentSchemas.query, "query"), ah(c.stats));
router.get("/", authRequired, validate(studentSchemas.query, "query"), ah(c.list));
router.get("/:id", authRequired,  validateId("id"), ah(c.getOne));

// Manage students (create/update/delete) - DIRECTOR & ADMIN only
router.post("/", authRequired,ah(c.create));
router.put("/:id",authRequired, validateId("id"), validate(studentSchemas.update), ah(c.update));
router.delete("/:id", authRequired,  validateId("id"), ah(c.remove));

module.exports = router;
