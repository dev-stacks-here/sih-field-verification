const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

function login(req, res) {
  const { userId, password } = req.body || {};
  if (!userId || !password) {
    return res.status(400).json({ error: "userId and password are required." });
  }

  const operator = db
    .prepare("SELECT * FROM operators WHERE user_id = ?")
    .get(userId.trim().toUpperCase());

  // Same generic error whether the user doesn't exist or the password is
  // wrong, so login can't be used to enumerate valid operator IDs.
  if (!operator) {
    return res.status(401).json({ error: "Invalid operator ID or password." });
  }
  const passwordMatches = bcrypt.compareSync(password, operator.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid operator ID or password." });
  }

  const token = jwt.sign(
    { sub: operator.user_id, name: operator.name, station: operator.station },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );

  res.json({
    token,
    operator: {
      userId: operator.user_id,
      name: operator.name,
      station: operator.station,
    },
  });
}

function me(req, res) {
  res.json({ operator: req.operator });
}

module.exports = { login, me };
