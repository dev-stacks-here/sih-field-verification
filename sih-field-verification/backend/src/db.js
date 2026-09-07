const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const DB_PATH = process.env.DB_PATH || "./data/field_verification.db";
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = new Database(path.resolve(DB_PATH));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS operators (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    station       TEXT,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scans (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id             TEXT UNIQUE NOT NULL,
    operator_id           TEXT NOT NULL,

    -- What the on-device (client) classifier proposed. Never trusted as the
    -- authoritative result on its own - see server_result below.
    client_result         TEXT NOT NULL CHECK (client_result IN ('positive','negative','inconclusive')),
    client_confidence     REAL NOT NULL,

    -- Recomputed on the server from the uploaded image bytes, independent of
    -- whatever the client sent. This is what makes the record trustworthy:
    -- an attacker who tampers with the client can lie about client_result,
    -- but cannot change what the server independently derives from the image.
    server_result         TEXT NOT NULL CHECK (server_result IN ('positive','negative','inconclusive')),
    server_confidence     REAL NOT NULL,
    server_hue            REAL,
    calibration_applied   INTEGER DEFAULT 0,

    -- Which method actually produced server_result/server_confidence above:
    -- 'pretrained-clip' (zero-shot CLIP model, preferred) or 'heuristic'
    -- (calibrated hue bucketing, used only when the ML service is
    -- unreachable) or 'failed' (both attempts errored - result forced to
    -- inconclusive). Recorded for audit/transparency, not part of the signed
    -- payload itself.
    classification_method TEXT DEFAULT 'heuristic',
    ml_scores              TEXT,

    -- The field-facing "result" is the server's finding. If client and server
    -- disagree beyond tolerance, needs_review is set so it surfaces in the log.
    result                TEXT NOT NULL CHECK (result IN ('positive','negative','inconclusive')),
    needs_review          INTEGER DEFAULT 0,

    latitude              REAL,
    longitude             REAL,
    location_simulated    INTEGER DEFAULT 0,
    location_acknowledged INTEGER DEFAULT 0,

    image_path            TEXT NOT NULL,
    image_hash            TEXT NOT NULL,
    signature              TEXT NOT NULL,

    captured_at           TEXT NOT NULL,
    received_at           TEXT NOT NULL,
    created_at            TEXT DEFAULT CURRENT_TIMESTAMP,

    -- Ground truth, filled in later once a lab confirms the sample (or a
    -- supervisor reviews it). Deliberately NOT part of the signed payload -
    -- adding it later must never be able to change what was signed at
    -- capture time. This is what lets the system report real accuracy
    -- instead of just citing the model vendor's benchmark numbers.
    confirmed_result       TEXT CHECK (confirmed_result IN ('positive','negative','inconclusive')),
    confirmed_at           TEXT,
    confirmed_by           TEXT,

    FOREIGN KEY (operator_id) REFERENCES operators(user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_scans_received_at ON scans(received_at);
  CREATE INDEX IF NOT EXISTS idx_scans_operator ON scans(operator_id);
  CREATE INDEX IF NOT EXISTS idx_scans_needs_review ON scans(needs_review);
`);

// --- lightweight migration for older DBs created before this schema existed ---
const scanCols = db.prepare("PRAGMA table_info(scans)").all().map((c) => c.name);
function addColumnIfMissing(name, def) {
  if (!scanCols.includes(name)) {
    db.exec(`ALTER TABLE scans ADD COLUMN ${name} ${def}`);
  }
}
addColumnIfMissing("client_result", "TEXT");
addColumnIfMissing("client_confidence", "REAL");
addColumnIfMissing("server_result", "TEXT");
addColumnIfMissing("server_confidence", "REAL");
addColumnIfMissing("server_hue", "REAL");
addColumnIfMissing("calibration_applied", "INTEGER DEFAULT 0");
addColumnIfMissing("classification_method", "TEXT DEFAULT 'heuristic'");
addColumnIfMissing("ml_scores", "TEXT");
addColumnIfMissing("needs_review", "INTEGER DEFAULT 0");
addColumnIfMissing("location_acknowledged", "INTEGER DEFAULT 0");
addColumnIfMissing("confirmed_result", "TEXT");
addColumnIfMissing("confirmed_at", "TEXT");
addColumnIfMissing("confirmed_by", "TEXT");

// Self-seed a default operator on first boot so the app is runnable immediately.
// Password is bcrypt-hashed (12 salt rounds) before it ever touches the database.
// THIS IS A DEMO CONVENIENCE ONLY - rotate/remove this account before any
// deployment beyond local development or a hackathon demo.
function ensureDefaultOperator() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM operators").get().c;
  if (count > 0) return;
  const defaultUserId = "R.SHARMA";
  const defaultPassword = "Field@123";
  const passwordHash = bcrypt.hashSync(defaultPassword, 12);
  db.prepare(
    "INSERT INTO operators (user_id, name, password_hash, station) VALUES (?,?,?,?)"
  ).run(defaultUserId, "R. Sharma", passwordHash, "Sector 12 Field Unit");
  console.log("------------------------------------------------------------");
  console.log("No operators existed yet — created a DEMO default account:");
  console.log(`  User ID : ${defaultUserId}`);
  console.log(`  Password: ${defaultPassword}`);
  console.log("This is for local demo use only. Add real accounts with");
  console.log("`npm run seed -- <ID> \"<Name>\" <password> [station]` and");
  console.log("remove this default before using this anywhere else.");
  console.log("------------------------------------------------------------");
}
ensureDefaultOperator();

module.exports = db;
