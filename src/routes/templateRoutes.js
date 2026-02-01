const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/templateController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");

router.get("/", authRequired, ah(c.list));
router.post("/", authRequired, allowDirectorOr("ADMIN"), ah(c.create));
router.put("/:id", authRequired, allowDirectorOr("ADMIN"), ah(c.update));
router.delete("/:id", authRequired, allowDirectorOr("ADMIN"), ah(c.remove));

module.exports = router;
