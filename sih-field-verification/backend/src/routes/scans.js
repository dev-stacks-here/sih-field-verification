const express = require("express");
const {
  createScan, listScans, getScan, getScanImage, verifyScan,
} = require("../controllers/scanController");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

router.use(authMiddleware);

router.post("/", createScan);
router.get("/", listScans);
router.get("/:recordId", getScan);
router.get("/:recordId/image", getScanImage);
router.get("/:recordId/verify", verifyScan);

module.exports = router;
