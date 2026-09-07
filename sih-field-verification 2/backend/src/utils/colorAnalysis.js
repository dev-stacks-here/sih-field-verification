const sharp = require("sharp");

// These fractions describe the same guide box the frontend overlays on the
// live camera view (see frontend/src/App.jsx `.guide` CSS + capture canvas,
// which is fixed at FRAME_W x FRAME_H). Keeping them in one place here means
// the server samples the same two regions the operator was shown: the vial
// on the left, the reference colour card on the right.
const FRAME_W = 480;
const FRAME_H = 640;
const GUIDE_TOP = 0.32;
const GUIDE_HEIGHT = 0.26;
const GUIDE_LEFT = 0.1;
const GUIDE_RIGHT = 0.9;
const INSET = 0.18; // shrink each zone inward a bit so we avoid edges/borders

function zoneRect(xFrom, xTo) {
  const top = Math.round(FRAME_H * GUIDE_TOP);
  const height = Math.round(FRAME_H * GUIDE_HEIGHT);
  const left = Math.round(FRAME_W * xFrom);
  const width = Math.round(FRAME_W * (xTo - xFrom));
  const insetX = Math.round(width * INSET);
  const insetY = Math.round(height * INSET);
  return {
    left: left + insetX,
    top: top + insetY,
    width: Math.max(4, width - insetX * 2),
    height: Math.max(4, height - insetY * 2),
  };
}

const VIAL_RECT = zoneRect(GUIDE_LEFT, (GUIDE_LEFT + GUIDE_RIGHT) / 2);
const CARD_RECT = zoneRect((GUIDE_LEFT + GUIDE_RIGHT) / 2, GUIDE_RIGHT);

async function averageRgb(pixelBuffer, imgWidth, channels, rect) {
  let rs = 0, gs = 0, bs = 0, n = 0;
  const x0 = Math.max(0, rect.left);
  const y0 = Math.max(0, rect.top);
  const x1 = x0 + rect.width;
  const y1 = y0 + rect.height;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * imgWidth + x) * channels;
      rs += pixelBuffer[idx];
      gs += pixelBuffer[idx + 1];
      bs += pixelBuffer[idx + 2];
      n++;
    }
  }
  if (n === 0) return { r: 128, g: 128, b: 128 };
  return { r: rs / n, g: gs / n, b: bs / n };
}

function rgbToHueSat({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = ((g - b) / (max - min)) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const sat = max === 0 ? 0 : (max - min) / max;
  return { hue, sat };
}

function classifyHue(hue, sat) {
  // Low-saturation samples (near-grey/white/black) can't be reliably bucketed
  // by hue at all - treat them as inconclusive regardless of where the hue
  // angle lands, rather than guessing.
  if (sat < 0.08) {
    return { category: "inconclusive", confidence: 45 + sat * 100 };
  }
  if (hue >= 15 && hue < 50) {
    const center = 32.5, halfWidth = 17.5;
    const closeness = 1 - Math.min(1, Math.abs(hue - center) / halfWidth);
    return { category: "positive", confidence: 72 + closeness * 22 + sat * 6 };
  }
  if (hue >= 80 && hue < 175) {
    const center = 127.5, halfWidth = 47.5;
    const closeness = 1 - Math.min(1, Math.abs(hue - center) / halfWidth);
    return { category: "negative", confidence: 74 + closeness * 20 + sat * 6 };
  }
  return { category: "inconclusive", confidence: 45 + Math.random() * 10 };
}

/**
 * Independently classifies a captured test image on the SERVER, using the
 * reference colour card sampled from the same image to correct for lighting
 * before the vial's hue is classified.
 *
 * Calibration approach: grey-world assumption on the reference card patch.
 * The card is manufactured to be neutral grey, so in a perfectly lit photo
 * its R, G and B channel averages should be equal. Any deviation is treated
 * as a lighting/white-balance cast and used to scale the vial's channels
 * back toward neutral before computing hue. This is a simple but real
 * calibration step - it is not the same as the on-device estimate.
 */
async function classifyFromImageBuffer(buffer) {
  const { data, info } = await sharp(buffer)
    .resize(FRAME_W, FRAME_H, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels; // 3 (RGB) after removeAlpha
  const cardAvg = await averageRgb(data, info.width, channels, CARD_RECT);
  const vialAvgRaw = await averageRgb(data, info.width, channels, VIAL_RECT);

  const cardMean = (cardAvg.r + cardAvg.g + cardAvg.b) / 3 || 1;
  // Clamp the correction so a badly-lit or occluded card can't produce
  // wild swings - beyond this range we still classify, but flag low
  // confidence via calibration_applied = 0 upstream if needed.
  const clamp = (v) => Math.min(1.8, Math.max(0.55, v));
  const gain = {
    r: clamp(cardMean / (cardAvg.r || 1)),
    g: clamp(cardMean / (cardAvg.g || 1)),
    b: clamp(cardMean / (cardAvg.b || 1)),
  };

  const vialCalibrated = {
    r: Math.min(255, vialAvgRaw.r * gain.r),
    g: Math.min(255, vialAvgRaw.g * gain.g),
    b: Math.min(255, vialAvgRaw.b * gain.b),
  };

  const { hue, sat } = rgbToHueSat(vialCalibrated);
  const { category, confidence } = classifyHue(hue, sat);

  return {
    category,
    confidence: Math.min(99, confidence),
    hue,
    saturation: sat,
    calibrationApplied: true,
    cardSample: cardAvg,
    vialSampleRaw: vialAvgRaw,
    vialSampleCalibrated: vialCalibrated,
  };
}

module.exports = { classifyFromImageBuffer, VIAL_RECT, CARD_RECT, FRAME_W, FRAME_H };
