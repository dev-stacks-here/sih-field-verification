const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing authentication token." });
  }
  try {
    // No hardcoded fallback secret - server.js refuses to boot without
    // JWT_SECRET set, so process.env.JWT_SECRET is guaranteed here.
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.operator = { userId: payload.sub, name: payload.name, station: payload.station };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
  }
}

module.exports = authMiddleware;
