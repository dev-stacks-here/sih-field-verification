const express = require("express");
const {
  createScan, listScans, getScan, getScanImage, verifyScan, confirmScan, getAccuracyStats,
} = require("../controllers/scanController");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

router.use(authMiddleware);

router.post("/", createScan);
router.get("/", listScans);
// Must come before /:recordId or "stats" would be parsed as a record ID.
router.get("/stats/accuracy", getAccuracyStats);
router.get("/:recordId", getScan);
router.get("/:recordId/image", getScanImage);
router.get("/:recordId/verify", verifyScan);
router.patch("/:recordId/confirm", confirmScan);

module.exports = router;
