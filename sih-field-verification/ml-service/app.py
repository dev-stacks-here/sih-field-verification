"""
Pretrained-model colour classifier for the Field Verification System.

Deliberately uses zero-shot classification with a pretrained CLIP model
(openai/clip-vit-base-patch32) instead of training a custom model:
- No labelled dataset of this specific kit's positive/negative reactions
  exists yet, so training a classifier from scratch would just be curve-fit
  to a handful of demo photos.
- CLIP was pretrained on hundreds of millions of image-text pairs and can be
  steered with natural-language prompts describing each outcome category,
  with zero additional training.
- The Node backend still runs its own independent, calibrated heuristic
  (backend/src/utils/colorAnalysis.js) as a cross-check. If this service is
  unreachable, the backend falls back to that heuristic automatically, so
  the app degrades gracefully rather than hard-failing on ML availability.

Run:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8000

First request after boot will be slow (model download + load); subsequent
requests are fast since the model stays resident in memory.
"""
import io
import logging

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("field-verification-ml")

MODEL_NAME = "openai/clip-vit-base-patch32"

# Natural-language prompts standing in for each outcome category. These are
# generic (any colorimetric test) on purpose for a hackathon demo; a real
# deployment should tighten these to the specific kit's documented colour
# bands (manufacturers publish exact hues per result band) for better
# separation between categories.
LABELS = {
    "positive": (
        "a close-up photo of a chemical test vial showing a strong pink, "
        "magenta, or purple colour change, indicating a positive result"
    ),
    "negative": (
        "a close-up photo of a chemical test vial that remained clear, "
        "pale, blue, or green with no significant colour change, "
        "indicating a negative result"
    ),
    "inconclusive": (
        "a close-up photo of a chemical test vial with a faint, murky, "
        "or ambiguous colour that does not clearly match a known result, "
        "or a photo that is blurry, poorly lit, or does not show a test vial"
    ),
}
CATEGORY_KEYS = list(LABELS.keys())
PROMPTS = [LABELS[k] for k in CATEGORY_KEYS]

app = FastAPI(title="Field Verification - Pretrained Colour Classifier")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None
_processor = None
_device = "cpu"


def _load_model():
    """Loads the pretrained CLIP model once, lazily, on first use."""
    global _model, _processor, _device
    if _model is not None:
        return
    import torch
    from transformers import CLIPModel, CLIPProcessor

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Loading pretrained model %s on %s ...", MODEL_NAME, _device)
    _model = CLIPModel.from_pretrained(MODEL_NAME).to(_device)
    _model.eval()
    _processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    logger.info("Model loaded. No training performed - pretrained weights only.")


@app.on_event("startup")
def startup():
    # Loaded eagerly at boot so the first real request isn't slow; comment
    # out and rely on the lazy _load_model() call in /classify if you'd
    # rather the service start instantly and pay the cost on first request.
    try:
        _load_model()
    except Exception:
        logger.exception("Model failed to preload at startup; will retry on first request.")


@app.get("/health")
def health():
    return {
        "status": "ok" if _model is not None else "model_not_loaded",
        "model": MODEL_NAME,
        "device": _device,
        "trained": False,
        "note": "Zero-shot pretrained CLIP classifier - no custom training performed.",
    }


@app.post("/classify")
async def classify(image: UploadFile = File(...)):
    _load_model()

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {exc}")

    import torch

    inputs = _processor(text=PROMPTS, images=img, return_tensors="pt", padding=True)
    inputs = {k: v.to(_device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = _model(**inputs)
        probs = outputs.logits_per_image.softmax(dim=1)[0].tolist()

    scores = {CATEGORY_KEYS[i]: round(probs[i] * 100, 2) for i in range(len(CATEGORY_KEYS))}
    best_idx = max(range(len(probs)), key=lambda i: probs[i])
    category = CATEGORY_KEYS[best_idx]
    confidence = scores[category]

    return {
        "category": category,
        "confidence": confidence,
        "scores": scores,
        "model": MODEL_NAME,
        "method": "zero-shot-clip-pretrained",
    }
