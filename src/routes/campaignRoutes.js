const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/campaignController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");
const { validate, validateId, campaignSchemas } = require("../middlewares/validation");

router.get("/", authRequired, ah(c.listCampaigns));
router.get("/:id", authRequired, validateId("id"), ah(c.getCampaign));
router.post("/", authRequired, validate(campaignSchemas.create), ah(c.createCampaign));
router.post("/:id/send",authRequired, validateId("id"), ah(c.sendCampaign));
router.post("/:id/stop", authRequired, validateId("id"), ah(c.stopCampaign));
router.post("/:id/cancel", authRequired, validateId("id"), ah(c.cancelCampaign));
router.get("/:id/logs", authRequired, validateId("id"), ah(c.getCampaignLogs));

module.exports = router;
