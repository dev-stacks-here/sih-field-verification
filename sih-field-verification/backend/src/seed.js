// Usage: npm run seed -- <USER_ID> "<Full Name>" <password> ["<Station>"]
require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

const [, , userId, name, password, ...stationParts] = process.argv;
const station = stationParts.join(" ") || "Unassigned";

if (!userId || !name || !password) {
  console.log('Usage: npm run seed -- <USER_ID> "<Full Name>" <password> ["<Station>"]');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
try {
  db.prepare(
    "INSERT INTO operators (user_id, name, password_hash, station) VALUES (?,?,?,?)"
  ).run(userId.trim().toUpperCase(), name, passwordHash, station);
  console.log(`Created operator ${userId.toUpperCase()} (${name}) at ${station}.`);
} catch (err) {
  if (String(err.message || err).includes("UNIQUE")) {
    console.log(`Operator ${userId.toUpperCase()} already exists — skipped.`);
  } else {
    console.error("Failed to create operator:", err);
    process.exit(1);
  }
}
