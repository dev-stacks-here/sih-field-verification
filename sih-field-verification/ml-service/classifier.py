"""
Shared pretrained-CLIP classification logic, used by both the FastAPI
service (app.py) and the offline evaluation script (evaluate.py). Kept in
one place so "what the app does in production" and "what evaluate.py
measures" can never silently drift apart.
"""
import logging

logger = logging.getLogger("field-verification-ml")

MODEL_NAME = "openai/clip-vit-base-patch32"

# Natural-language prompts standing in for each outcome category. These are
# generic (any colorimetric test) on purpose for a hackathon demo; a real
# deployment should tighten these to the specific kit's documented colour
# bands (manufacturers publish exact hues per result band) for better
# separation between categories. Retune these against evaluate.py's
# confusion matrix, not by eye.
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

_model = None
_processor = None
_device = "cpu"


def load_model():
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


def model_status():
    return {
        "status": "ok" if _model is not None else "model_not_loaded",
        "model": MODEL_NAME,
        "device": _device,
        "trained": False,
        "note": "Zero-shot pretrained CLIP classifier - no custom training performed.",
    }


def classify_image(pil_image):
    """Runs zero-shot CLIP classification on a PIL image (RGB). Returns the
    same shape the /classify endpoint responds with, so app.py and
    evaluate.py always agree on what "the classifier said" means."""
    load_model()
    import torch

    inputs = _processor(text=PROMPTS, images=pil_image, return_tensors="pt", padding=True)
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
