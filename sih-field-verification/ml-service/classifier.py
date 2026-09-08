"""
Dual-Model Vision Classification Engine for the Field Verification System.

Model 1 (Foundation Model):
    Pretrained Google SigLIP (google/siglip-base-patch16-224).
    Zero-shot classification against natural-language prompts describing each
    reaction category. Runs out of the box with zero training required.

Model 2 (Custom Domain Model):
    Lightweight, domain-specific classifier trained on confirmed photos of the
    chemical test kit (via train_custom_model.py). Loaded dynamically from
    models/custom_classifier.pt if present.

Ensemble Engine:
    - If Model 2 is present: Combines predictions via weighted ensemble, checks
      for consensus, and flags disagreement for human supervisor review.
    - If Model 2 is not yet trained: Operates 100% on SigLIP gracefully with zero
      breakage, signaling that Model 2 is awaiting training weights.
"""
import logging
import os
from pathlib import Path
from PIL import Image

from authenticity import analyze_authenticity

logger = logging.getLogger("field-verification-ml")

# Model 1: Foundation Vision-Language Model
MODEL_NAME = "google/siglip-base-patch16-224"

# Model 2: Custom domain classifier path
DEFAULT_CUSTOM_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "custom_classifier.pt")
CUSTOM_MODEL_PATH = os.getenv("CUSTOM_MODEL_PATH", DEFAULT_CUSTOM_MODEL_PATH)

# Natural-language prompts tuned for SigLIP zero-shot reaction classification
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

# Ensemble weights (configurable via environment variables)
WEIGHT_MODEL1 = float(os.getenv("ENSEMBLE_WEIGHT_M1", "0.40"))
WEIGHT_MODEL2 = float(os.getenv("ENSEMBLE_WEIGHT_M2", "0.60"))

_model1 = None
_processor1 = None
_model2 = None
_device = "cpu"


def _get_device():
    global _device
    import torch
    _device = "cuda" if torch.cuda.is_available() else "cpu"
    return _device


def load_model1():
    """Loads the pretrained SigLIP model once on first use."""
    global _model1, _processor1
    if _model1 is not None:
        return
    import torch
    from transformers import AutoModel, AutoProcessor

    dev = _get_device()
    logger.info("Loading Foundation Model (SigLIP) %s on %s ...", MODEL_NAME, dev)
    _model1 = AutoModel.from_pretrained(MODEL_NAME).to(dev)
    _model1.eval()
    _processor1 = AutoProcessor.from_pretrained(MODEL_NAME)
    logger.info("SigLIP model loaded successfully.")


def load_model2():
    """Attempts to load Model 2 (Custom Domain Model) if weights exist."""
    global _model2
    if _model2 is not None:
        return
    if not os.path.isfile(CUSTOM_MODEL_PATH):
        logger.info("Model 2 weights not found at %s. Running in single-model (SigLIP) mode.", CUSTOM_MODEL_PATH)
        return

    import torch
    dev = _get_device()
    try:
        from train_custom_model import CustomVialClassifier
        checkpoint = torch.load(CUSTOM_MODEL_PATH, map_location=dev)
        model = CustomVialClassifier(num_classes=len(CATEGORY_KEYS)).to(dev)
        if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint:
            model.load_state_dict(checkpoint["model_state_dict"])
        elif isinstance(checkpoint, dict):
            model.load_state_dict(checkpoint)
        else:
            model = checkpoint.to(dev)
        model.eval()
        _model2 = model
        logger.info("Custom Domain Model (Model 2) loaded successfully from %s.", CUSTOM_MODEL_PATH)
    except Exception as exc:
        logger.warning("Failed to load Model 2 from %s: %s. Continuing with Model 1.", CUSTOM_MODEL_PATH, exc)
        _model2 = None


def load_model():
    """Initializes both models."""
    load_model1()
    load_model2()


def model_status():
    """Returns the operational status of both models and the ensemble."""
    return {
        "status": "ok" if _model1 is not None else "model_not_loaded",
        "device": _device,
        "ensemble_active": _model2 is not None,
        "model1": {
            "name": MODEL_NAME,
            "type": "foundation-vlm-siglip",
            "status": "loaded" if _model1 is not None else "not_loaded",
            "zero_shot": True,
        },
        "model2": {
            "name": "custom-domain-vial-classifier",
            "type": "supervised-cnn",
            "status": "loaded" if _model2 is not None else "awaiting_training_weights",
            "weights_path": CUSTOM_MODEL_PATH,
            "found_on_disk": os.path.isfile(CUSTOM_MODEL_PATH),
        },
        "weights": {
            "model1_siglip": WEIGHT_MODEL1,
            "model2_custom": WEIGHT_MODEL2,
        },
    }


def _classify_siglip(pil_image):
    """Runs zero-shot classification with SigLIP."""
    load_model1()
    import torch

    inputs = _processor1(text=PROMPTS, images=pil_image, padding="max_length", return_tensors="pt")
    inputs = {k: v.to(_device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = _model1(**inputs)
        logits = outputs.logits_per_image
        probs = torch.softmax(logits, dim=-1)[0].tolist()

    scores = {CATEGORY_KEYS[i]: round(probs[i] * 100, 2) for i in range(len(CATEGORY_KEYS))}
    best_idx = max(range(len(probs)), key=lambda i: probs[i])
    category = CATEGORY_KEYS[best_idx]
    confidence = scores[category]

    return category, confidence, scores


def _classify_custom(pil_image):
    """Runs classification with custom-trained Model 2."""
    load_model2()
    if _model2 is None:
        return None

    import torch
    from train_custom_model import preprocess_image

    tensor = preprocess_image(pil_image).unsqueeze(0).to(_device)
    with torch.no_grad():
        logits = _model2(tensor)
        probs = torch.softmax(logits, dim=-1)[0].tolist()

    scores = {CATEGORY_KEYS[i]: round(probs[i] * 100, 2) for i in range(len(CATEGORY_KEYS))}
    best_idx = max(range(len(probs)), key=lambda i: probs[i])
    category = CATEGORY_KEYS[best_idx]
    confidence = scores[category]

    return category, confidence, scores


def evaluate_authenticity(pil_image: Image.Image):
    """
    Direct endpoint for evaluating image authenticity & anti-spoofing.
    """
    load_model1()
    return analyze_authenticity(pil_image, _model1, _processor1, _device)


def classify_image(pil_image: Image.Image):
    """
    Main classification entry point.
    Runs SigLIP (Model 1) and Custom Model (Model 2, if loaded), returning
    unified predictions, ensemble consensus diagnostics, and forensic authenticity.
    """
    m1_category, m1_confidence, m1_scores = _classify_siglip(pil_image)
    m2_result = _classify_custom(pil_image)

    # Forensic Authenticity & Anti-Spoof Evaluation (SigLIP zero-shot + 2D FFT Moiré + noise residual)
    authenticity_res = analyze_authenticity(pil_image, _model1, _processor1, _device)

    # Dual-model ensemble active
    if m2_result is not None:
        m2_category, m2_confidence, m2_scores = m2_result

        # Weighted combination of probabilities
        combined_scores = {}
        for cat in CATEGORY_KEYS:
            combined = (WEIGHT_MODEL1 * m1_scores[cat]) + (WEIGHT_MODEL2 * m2_scores[cat])
            combined_scores[cat] = round(combined, 2)

        best_cat = max(CATEGORY_KEYS, key=lambda c: combined_scores[c])
        combined_confidence = combined_scores[best_cat]
        disagreement = (m1_category != m2_category)

        return {
            "category": best_cat,
            "confidence": combined_confidence,
            "scores": combined_scores,
            "model": f"{MODEL_NAME} + custom-vial-classifier",
            "method": "dual-model-ensemble",
            "authenticity": authenticity_res,
            "ensemble": {
                "active": True,
                "disagreement": disagreement,
                "consensus": not disagreement,
                "model1": {
                    "name": MODEL_NAME,
                    "category": m1_category,
                    "confidence": m1_confidence,
                    "scores": m1_scores,
                    "weight": WEIGHT_MODEL1,
                },
                "model2": {
                    "name": "custom-vial-classifier",
                    "category": m2_category,
                    "confidence": m2_confidence,
                    "scores": m2_scores,
                    "weight": WEIGHT_MODEL2,
                },
            },
        }

    # Model 1 (SigLIP standalone mode)
    return {
        "category": m1_category,
        "confidence": m1_confidence,
        "scores": m1_scores,
        "model": MODEL_NAME,
        "method": "zero-shot-siglip-pretrained",
        "authenticity": authenticity_res,
        "ensemble": {
            "active": False,
            "disagreement": False,
            "consensus": True,
            "model1": {
                "name": MODEL_NAME,
                "category": m1_category,
                "confidence": m1_confidence,
                "scores": m1_scores,
            },
            "model2": None,
            "model2_status": "awaiting_training_weights",
            "model2_expected_path": CUSTOM_MODEL_PATH,
        },
    }
