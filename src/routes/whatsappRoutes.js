const router = require("express").Router();
const ah = require("../middlewares/asyncHandler");
const c = require("../controllers/whatsappController");
const { authRequired, allowDirectorOr } = require("../middleware/auth");
const { getState } = require("../services/whatsapp/client");

router.get("/state", authRequired, ah(c.state));
router.get("/qr", authRequired, ah(c.qr));
router.post("/restart", authRequired, ah(c.restart));
router.post("/full-reset", authRequired, ah(c.fullReset));

// Temporary debug route (no auth) to quickly check QR/state during development.
// Mounted at /api/whatsapp/debug-qr
router.get(
	"/debug-qr",
	ah(async (req, res) => {
		const st = getState();
		return res.json({ qr: st.lastQr || null, ready: !!st.ready, lastDisconnect: st.lastDisconnect || null });
	})
);


module.exports = router;
