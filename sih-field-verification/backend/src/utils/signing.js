const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEYS_DIR = path.join(__dirname, "..", "..", "keys");
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, "private.pem");
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, "public.pem");

// Generates a device/server signing keypair the first time this runs.
// private.pem must never be committed or shared - it's what makes a
// signature meaningful evidence that *this* server produced the record.
function ensureKeys() {
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) return;
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(
    PRIVATE_KEY_PATH,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 }
  );
  fs.writeFileSync(
    PUBLIC_KEY_PATH,
    publicKey.export({ type: "spki", format: "pem" })
  );
  console.log("Generated a new Ed25519 signing keypair in backend/keys/.");
  console.log("Keep private.pem secret; public.pem can be shared for verification.");
}
ensureKeys();

const privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH));
const publicKey = crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_PATH));

function signPayload(payload) {
  // Node requires a null digest algorithm for Ed25519/Ed448 signing.
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), privateKey);
  return signature.toString("base64");
}

function verifyPayload(payload, signatureB64) {
  try {
    return crypto.verify(
      null,
      Buffer.from(payload, "utf8"),
      publicKey,
      Buffer.from(signatureB64, "base64")
    );
  } catch (e) {
    return false;
  }
}

function getPublicKeyPem() {
  return fs.readFileSync(PUBLIC_KEY_PATH, "utf8");
}

module.exports = { signPayload, verifyPayload, getPublicKeyPem };
