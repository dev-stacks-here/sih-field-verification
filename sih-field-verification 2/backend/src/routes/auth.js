const express = require("express");
const { login, me } = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

router.post("/login", login);
router.get("/me", authMiddleware, me);

module.exports = router;
