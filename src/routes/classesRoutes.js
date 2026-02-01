const express = require("express");
const router = express.Router();
const classesController = require("../controllers/classesController");

const { authRequired } = require("../middleware/auth");

router.use(authRequired);

router.get("/", authRequired, classesController.list);
router.get("/:id",authRequired, classesController.getOne);
router.post("/", authRequired,classesController.create);
router.put("/:id", authRequired, classesController.update);
router.delete("/:id", authRequired, classesController.remove);

module.exports = router;
