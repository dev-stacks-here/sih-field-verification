const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { sha256 } = require("../utils/hash");
const { signPayload, verifyPayload, getPublicKeyPem } = require("../utils/signing");
const { classifyFromImageBuffer } = require("../utils/colorAnalysis");
const { classifyWithPretrainedModel } = require("../utils/mlClassifier");

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || "./uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const RESULT_CATEGORIES = ["positive", "negative", "inconclusive"];
const HUE_TOLERANCE = Number(process.env.CLASSIFICATION_DISAGREEMENT_HUE_TOLERANCE) || 25;

function generateRecordId() {
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `FV-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

// The exact fields (and order) that get signed. Any change to any of these
// after the fact invalidates the signature, which is what makes the record
// tamper-evident. Deliberately signs the SERVER's authoritative result, not
// whatever category the client device proposed, so a modified client can't
// forge what the signature attests to.
function buildPayload({
  recordId, imageHash, capturedAt, operatorUserId, latitude, longitude,
  result, clientResult, needsReview,
}) {
  return [
    recordId, imageHash, capturedAt, operatorUserId,
    latitude ?? "", longitude ?? "", result, clientResult, needsReview ? "1" : "0",
  ].join("|");
}

function formatScan(row) {
  return {
    recordId: row.record_id,
    operatorId: row.operator_id,
    result: row.result,
    needsReview: !!row.needs_review,
    client: { result: row.client_result, confidence: row.client_confidence },
    server: {
      result: row.server_result,
      confidence: row.server_confidence,
      hue: row.server_hue,
      calibrationApplied: !!row.calibration_applied,
      method: row.classification_method,
      scores: row.ml_scores ? JSON.parse(row.ml_scores) : null,
    },
    confidence: row.server_confidence, // primary confidence shown in UI = server's
    latitude: row.latitude,
    longitude: row.longitude,
    locationSimulated: !!row.location_simulated,
    locationAcknowledged: !!row.location_acknowledged,
    imageHash: row.image_hash,
    signature: row.signature,
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    confirmed: row.confirmed_result
      ? { result: row.confirmed_result, at: row.confirmed_at, by: row.confirmed_by }
      : null,
  };
}

async function createScan(req, res) {
  try {
    const {
      imageDataUrl,
      result, // client-proposed category - advisory only, never trusted alone
      confidence,
      latitude,
      longitude,
      locationSimulated,
      locationAcknowledged,
      capturedAt,
    } = req.body || {};

    if (!imageDataUrl || !result || confidence === undefined || confidence === null) {
      return res.status(400).json({ error: "imageDataUrl, result and confidence are required." });
    }
    if (!RESULT_CATEGORIES.includes(result)) {
      return res.status(400).json({ error: `result must be one of: ${RESULT_CATEGORIES.join(", ")}` });
    }
    if (locationSimulated && !locationAcknowledged) {
      return res.status(400).json({
        error: "GPS location could not be obtained. The operator must acknowledge simulated/manual location before the record can be signed.",
      });
    }

    const match = /^data:image\/(jpeg|jpg|png);base64,(.+)$/.exec(imageDataUrl);
    if (!match) {
      return res.status(400).json({ error: "imageDataUrl must be a base64-encoded JPEG or PNG data URL." });
    }
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0) {
      return res.status(400).json({ error: "Decoded image is empty." });
    }

    const recordId = generateRecordId();
    const imageFilename = `${recordId}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, imageFilename), buffer);

    // The hash is computed here from the bytes actually written to disk -
    // never trusted from the client - so it's authoritative for chain of custody.
    const imageHash = sha256(buffer);

    // Independently re-derive the result from the image itself - this is
    // what actually backs the "result" field, never the client's proposal.
    // Preferred path: a pretrained image model (zero-shot CLIP, no custom
    // training - see ml-service/README.md) run against the cropped vial
    // region. If that service is unreachable/errors/times out, fall back to
    // the calibrated hue-bucketing heuristic so the app still works offline.
    let serverAnalysis;
    let classificationMethod;
    let mlScores = null;
    let ensembleDisagreement = false;
    try {
      const mlResult = await classifyWithPretrainedModel(buffer);
      serverAnalysis = {
        category: mlResult.category,
        confidence: mlResult.confidence,
        hue: null,
        calibrationApplied: false,
      };
      mlScores = mlResult.scores;
      classificationMethod = mlResult.method || "siglip-base";
      ensembleDisagreement = !!(mlResult.ensemble && mlResult.ensemble.disagreement);
    } catch (mlErr) {
      console.warn("ML classifier unavailable, falling back to heuristic:", mlErr.message);
      try {
        serverAnalysis = await classifyFromImageBuffer(buffer);
        classificationMethod = "heuristic";
      } catch (heuristicErr) {
        console.error("Heuristic classification also failed:", heuristicErr);
        serverAnalysis = { category: "inconclusive", confidence: 0, hue: null, calibrationApplied: false };
        classificationMethod = "failed";
      }
    }

    const hueDiff = (a, b) => {
      if (a === null || b === null || a === undefined || b === undefined) return 999;
      const d = Math.abs(a - b) % 360;
      return Math.min(d, 360 - d);
    };
    // Disagreement is judged at category level: if client and server land in
    // different buckets, server confidence is weak, or dual-model ensemble
    // models disagree, flag for review rather than silently trusting either side.
    const categoryDisagrees = serverAnalysis.category !== result;
    const lowServerConfidence = serverAnalysis.confidence < 55;
    const needsReview = categoryDisagrees || lowServerConfidence || ensembleDisagreement;

    const receivedAt = new Date().toISOString();
    const finalCapturedAt = capturedAt || receivedAt;
    const operatorUserId = req.operator.userId; // from the verified JWT, not the request body

    const authoritativeResult = serverAnalysis.category;

    const payload = buildPayload({
      recordId,
      imageHash,
      capturedAt: finalCapturedAt,
      operatorUserId,
      latitude,
      longitude,
      result: authoritativeResult,
      clientResult: result,
      needsReview,
    });
    const signature = signPayload(payload);

    db.prepare(
      `INSERT INTO scans (
         record_id, operator_id,
         client_result, client_confidence,
         server_result, server_confidence, server_hue, calibration_applied,
         classification_method, ml_scores,
         result, needs_review,
         latitude, longitude, location_simulated, location_acknowledged,
         image_path, image_hash, signature, captured_at, received_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      recordId,
      operatorUserId,
      result,
      confidence,
      serverAnalysis.category,
      serverAnalysis.confidence,
      serverAnalysis.hue ?? null,
      serverAnalysis.calibrationApplied ? 1 : 0,
      classificationMethod,
      mlScores ? JSON.stringify(mlScores) : null,
      authoritativeResult,
      needsReview ? 1 : 0,
      latitude ?? null,
      longitude ?? null,
      locationSimulated ? 1 : 0,
      locationAcknowledged ? 1 : 0,
      imageFilename,
      imageHash,
      signature,
      finalCapturedAt,
      receivedAt
    );

    const row = db.prepare("SELECT * FROM scans WHERE record_id = ?").get(recordId);
    res.status(201).json({ scan: formatScan(row) });
  } catch (err) {
    console.error("createScan failed:", err);
    res.status(500).json({ error: "Failed to create scan record." });
  }
}

function listScans(req, res) {
  const { q = "", result, needsReview, limit = 50, offset = 0 } = req.query;
  let query = "SELECT * FROM scans WHERE 1=1";
  const params = [];

  if (q) {
    query += " AND (record_id LIKE ? OR operator_id LIKE ? OR result LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (result && RESULT_CATEGORIES.includes(result)) {
    query += " AND result = ?";
    params.push(result);
  }
  if (needsReview === "1" || needsReview === "true") {
    query += " AND needs_review = 1";
  }
  query += " ORDER BY received_at DESC LIMIT ? OFFSET ?";
  params.push(Math.min(Number(limit) || 50, 200), Number(offset) || 0);

  const rows = db.prepare(query).all(...params);
  res.json({ scans: rows.map(formatScan) });
}

function getScan(req, res) {
  const row = db.prepare("SELECT * FROM scans WHERE record_id = ?").get(req.params.recordId);
  if (!row) return res.status(404).json({ error: "Record not found." });
  res.json({ scan: formatScan(row) });
}

function getScanImage(req, res) {
  const row = db.prepare("SELECT image_path FROM scans WHERE record_id = ?").get(req.params.recordId);
  if (!row) return res.status(404).json({ error: "Record not found." });

  const filePath = path.join(UPLOADS_DIR, row.image_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Image file missing." });
  res.sendFile(filePath);
}

// Recomputes the image hash from disk and re-verifies the signature against
// the stored fields - proves whether the record has been altered since capture.
function verifyScan(req, res) {
  const row = db.prepare("SELECT * FROM scans WHERE record_id = ?").get(req.params.recordId);
  if (!row) return res.status(404).json({ error: "Record not found." });

  const filePath = path.join(UPLOADS_DIR, row.image_path);
  let hashMatches = false;
  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    hashMatches = sha256(buffer) === row.image_hash;
  }

  const payload = buildPayload({
    recordId: row.record_id,
    imageHash: row.image_hash,
    capturedAt: row.captured_at,
    operatorUserId: row.operator_id,
    latitude: row.latitude,
    longitude: row.longitude,
    result: row.result,
    clientResult: row.client_result,
    needsReview: !!row.needs_review,
  });
  const signatureValid = verifyPayload(payload, row.signature);

  res.json({
    recordId: row.record_id,
    hashMatches,
    signatureValid,
    valid: hashMatches && signatureValid,
    publicKey: getPublicKeyPem(),
  });
}

// Records ground truth for a scan once it's known - typically after a lab
// confirms the sample, or a supervisor reviews a flagged record. This is
// intentionally a separate write path from createScan: it never touches
// result/signature/image_hash, so a record's signature still attests only
// to what was captured and computed at the time of the field test. Without
// this, "classifier accuracy" is just a claim about the model on someone
// else's benchmark, not about this kit under real field conditions.
function confirmScan(req, res) {
  const { confirmedResult } = req.body || {};
  if (!RESULT_CATEGORIES.includes(confirmedResult)) {
    return res.status(400).json({ error: `confirmedResult must be one of: ${RESULT_CATEGORIES.join(", ")}` });
  }
  const row = db.prepare("SELECT record_id FROM scans WHERE record_id = ?").get(req.params.recordId);
  if (!row) return res.status(404).json({ error: "Record not found." });

  db.prepare(
    "UPDATE scans SET confirmed_result = ?, confirmed_at = ?, confirmed_by = ? WHERE record_id = ?"
  ).run(confirmedResult, new Date().toISOString(), req.operator.userId, req.params.recordId);

  const updated = db.prepare("SELECT * FROM scans WHERE record_id = ?").get(req.params.recordId);
  res.json({ scan: formatScan(updated) });
}

// Accuracy report computed from confirmed (ground-truth) records only, split
// by which classifier produced the signed result. Empty/near-empty results
// are expected and reported honestly (see ml-service/evaluate.py for how to
// get a first accuracy number from a labelled photo set before real
// confirmations have accumulated).
function getAccuracyStats(req, res) {
  const rows = db.prepare(
    "SELECT result, classification_method, confirmed_result FROM scans WHERE confirmed_result IS NOT NULL"
  ).all();

  const byMethod = {};
  for (const row of rows) {
    const method = row.classification_method || "unknown";
    if (!byMethod[method]) {
      byMethod[method] = {
        method,
        total: 0,
        correct: 0,
        confusionMatrix: Object.fromEntries(
          RESULT_CATEGORIES.map((actual) => [
            actual,
            Object.fromEntries(RESULT_CATEGORIES.map((predicted) => [predicted, 0])),
          ])
        ),
      };
    }
    const bucket = byMethod[method];
    bucket.total += 1;
    if (row.result === row.confirmed_result) bucket.correct += 1;
    if (bucket.confusionMatrix[row.confirmed_result] && row.result in bucket.confusionMatrix[row.confirmed_result]) {
      bucket.confusionMatrix[row.confirmed_result][row.result] += 1;
    }
  }

  const methods = Object.values(byMethod).map((b) => ({
    ...b,
    accuracy: b.total ? Number(((b.correct / b.total) * 100).toFixed(1)) : null,
  }));

  res.json({
    confirmedCount: rows.length,
    methods,
    note: "Confusion matrix rows = confirmed (ground-truth) category, columns = predicted category.",
  });
}

function deleteScan(req, res) {
  try {
    const { recordId } = req.params;
    const { password } = req.body || {};

    if (!password) {
      return res.status(401).json({
        error: "Security Authentication Required: Officer password must be provided to remove scan records.",
      });
    }

    const operator = db
      .prepare("SELECT * FROM operators WHERE user_id = ?")
      .get(req.operator.userId);

    if (!operator || !bcrypt.compareSync(password, operator.password_hash)) {
      return res.status(401).json({
        error: "Authentication failed: Invalid officer password. Access denied.",
      });
    }

    const scan = db.prepare("SELECT * FROM scans WHERE record_id = ?").get(recordId);
    if (!scan) {
      return res.status(404).json({ error: "Scan record not found." });
    }

    // Unlink image file if present
    if (scan.image_path) {
      const filePath = path.join(UPLOADS_DIR, scan.image_path);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.warn("Failed to delete image file:", filePath, e.message);
        }
      }
    }

    db.prepare("DELETE FROM scans WHERE record_id = ?").run(recordId);

    res.json({
      success: true,
      message: `Field scan ${recordId} has been securely removed.`,
      recordId,
    });
  } catch (err) {
    console.error("deleteScan error:", err);
    res.status(500).json({ error: "Failed to delete scan record." });
  }
}

function purgeScans(req, res) {
  try {
    const { password, all } = req.body || {};

    if (!password) {
      return res.status(401).json({
        error: "Security Authentication Required: Officer password must be provided to clear recent scans.",
      });
    }

    const operator = db
      .prepare("SELECT * FROM operators WHERE user_id = ?")
      .get(req.operator.userId);

    if (!operator || !bcrypt.compareSync(password, operator.password_hash)) {
      return res.status(401).json({
        error: "Authentication failed: Invalid officer password. Access denied.",
      });
    }

    const shouldPurgeAll = all === true || req.query.all === "true";
    const query = shouldPurgeAll
      ? "SELECT record_id, image_path FROM scans"
      : "SELECT record_id, image_path FROM scans WHERE operator_id = ?";
    const params = shouldPurgeAll ? [] : [req.operator.userId];

    let scans = db.prepare(query).all(...params);

    if (scans.length === 0 && !shouldPurgeAll) {
      scans = db.prepare("SELECT record_id, image_path FROM scans").all();
    }

    for (const scan of scans) {
      if (scan.image_path) {
        const filePath = path.join(UPLOADS_DIR, scan.image_path);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.warn("Failed to delete image file:", filePath, e.message);
          }
        }
      }
    }

    let result;
    if (shouldPurgeAll || scans.length > 0) {
      result = db.prepare("DELETE FROM scans").run();
    } else {
      result = db.prepare("DELETE FROM scans WHERE operator_id = ?").run(req.operator.userId);
    }

    res.json({
      success: true,
      message: `Successfully purged ${result.changes} scan records.`,
      count: result.changes,
    });
  } catch (err) {
    console.error("purgeScans error:", err);
    res.status(500).json({ error: "Failed to purge scan records." });
  }
}

module.exports = {
  createScan,
  listScans,
  getScan,
  getScanImage,
  verifyScan,
  confirmScan,
  getAccuracyStats,
  deleteScan,
  purgeScans,
};
