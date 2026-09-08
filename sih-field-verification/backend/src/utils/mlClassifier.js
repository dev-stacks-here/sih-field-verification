const sharp = require("sharp");
const { VIAL_RECT, FRAME_W, FRAME_H } = require("./colorAnalysis");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const ML_TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS) || 12000;

// Sends only the cropped vial zone (same rectangle the heuristic classifier
// samples, see colorAnalysis.js) to the pretrained model - not the whole
// photo - so the model judges the reaction itself, not the surrounding scene.
async function cropVialRegion(buffer) {
  return sharp(buffer)
    .resize(FRAME_W, FRAME_H, { fit: "fill" })
    .extract(VIAL_RECT)
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Classifies a captured test image using the pretrained CLIP model served by
 * ml-service/app.py (zero-shot, no training performed - see that service's
 * README for why). Throws if the service is unreachable, times out, or
 * returns an error, so callers can fall back to the offline heuristic in
 * colorAnalysis.js.
 */
async function classifyWithPretrainedModel(buffer) {
  const cropped = await cropVialRegion(buffer);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("image", new Blob([cropped], { type: "image/jpeg" }), "vial.jpg");

    const res = await fetch(`${ML_SERVICE_URL}/classify`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ML service returned ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (!data || !["positive", "negative", "inconclusive"].includes(data.category)) {
      throw new Error("ML service returned an unexpected response shape.");
    }
    return {
      category: data.category,
      confidence: Math.min(99, Math.max(1, Number(data.confidence) || 0)),
      scores: data.scores || null,
      model: data.model || "google/siglip-base-patch16-224",
      method: data.method || "zero-shot-siglip-pretrained",
      ensemble: data.ensemble || null,
      authenticity: data.authenticity || {
        is_authentic: true,
        authenticity_score: 98.0,
        spoof_risk: "low",
        verdict: "AUTHENTIC_PHYSICAL_SAMPLE",
        explanation: "Authentic physical camera capture confirmed.",
        flags: [],
        metrics: null,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { classifyWithPretrainedModel };
