"""
Dual-Model Vision Classification Microservice for Field Verification.

Architecture:
- Model 1 (Foundation): Google SigLIP (google/siglip-base-patch16-224)
  Zero-shot classification against natural-language category prompts.
- Model 2 (Domain-Trained): Lightweight PyTorch custom classifier
  Loaded dynamically from models/custom_classifier.pt when trained.
- Ensemble Engine: Combines Model 1 and Model 2, flags discrepancies for review.
- Fallback: The Node backend maintains its own heuristic fallback in case this
  service is unreachable.
"""
import io
import logging

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

import classifier

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("field-verification-ml")

app = FastAPI(title="Field Verification - Dual-Model Vision Classifier (SigLIP + Custom)")
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


@app.post("/authenticity")
async def check_authenticity(image: UploadFile = File(...)):
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {exc}")

    return classifier.evaluate_authenticity(img)

