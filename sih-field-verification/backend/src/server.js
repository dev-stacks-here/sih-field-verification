require("dotenv").config();

// Fail fast rather than silently signing sessions with a guessable default.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "replace_this_with_a_long_random_string") {
  console.error("------------------------------------------------------------");
  console.error("JWT_SECRET is not set (or still has its placeholder value).");
  console.error("Copy backend/.env.example to backend/.env and set a real,");
  console.error("random JWT_SECRET before starting the server. Generate one with:");
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error("------------------------------------------------------------");
  process.exit(1);
}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

require("./db"); // opens the DB, creates tables, seeds a default operator if empty
require("./utils/signing"); // ensures the Ed25519 signing keypair exists

const authRoutes = require("./routes/auth");
const scanRoutes = require("./routes/scans");

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json({ limit: "15mb" })); // captured images arrive as base64 JSON
app.use(morgan("dev"));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "field-verification-backend" });
});

app.use("/api/auth", authRoutes);
app.use("/api/scans", scanRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Field Verification backend listening on http://localhost:${PORT}`);
});
