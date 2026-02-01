const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/authController");
const { authRequired } = require("../middleware/auth");
const { validate, userSchemas } = require("../middlewares/validation");

router.post("/login", ah(c.login));
router.post("/logout", authRequired, ah(c.logout));

router.get("/me", authRequired, ah(c.me));
router.put("/me", authRequired, ah(c.updateMe));
router.put("/me/password", authRequired, validate(userSchemas.changePassword), ah(c.changeMyPassword));

module.exports = router;
