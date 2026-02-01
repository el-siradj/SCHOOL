const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/usersController");
const { authRequired, requireRole } = require("../middleware/auth");
const { validate, validateId, userSchemas } = require("../middlewares/validation");

router.get("/", authRequired, requireRole("DIRECTOR"), ah(c.list));
router.post("/", authRequired, requireRole("DIRECTOR"), validate(userSchemas.create), ah(c.create));
router.put("/:id", authRequired, requireRole("DIRECTOR"), validateId("id"), validate(userSchemas.update), ah(c.update));
router.put("/:id/password", authRequired, requireRole("DIRECTOR"), validateId("id"), validate(userSchemas.resetPassword), ah(c.setPassword));
router.delete("/:id", authRequired, requireRole("DIRECTOR"), validateId("id"), ah(c.remove));

module.exports = router;
