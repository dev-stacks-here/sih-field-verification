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

For actual accuracy numbers (not just this design rationale), see
evaluate.py - it runs this same classifier against a labelled folder of
images and reports accuracy + a confusion matrix. Run it against real kit
photos before citing an accuracy figure to judges.

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

import classifier

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("field-verification-ml")

app = FastAPI(title="Field Verification - Pretrained Colour Classifier")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    # Loaded eagerly at boot so the first real request isn't slow; comment
    # out and rely on the lazy load in classify() if you'd rather the
    # service start instantly and pay the cost on first request.
    try:
        classifier.load_model()
    except Exception:
        logger.exception("Model failed to preload at startup; will retry on first request.")


@app.get("/health")
def health():
    return classifier.model_status()


@app.post("/classify")
async def classify(image: UploadFile = File(...)):
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {exc}")

    return classifier.classify_image(img)
