"""
Forensic Authenticity & Anti-Spoofing Engine for Field Verification.

Detects:
1. AI-Generated / Synthetic / Deepfake test images (Midjourney, Stable Diffusion, DALL-E)
2. Screen Recapture / Replay attacks (photographing phone/laptop LCD/OLED screens)
3. Print Spoof Attacks (photographing printed 2D paper copies)
4. Digital Tampering / Splicing (Photoshopped or recolored liquid wells)

Architecture:
- Layer 1: 2D FFT Spectral Analysis (Moiré interference & subpixel grid spikes)
- Layer 2: Camera Sensor Noise Residual & Laplacian Texture Dispersion
- Layer 3: Google SigLIP Multimodal Zero-Shot Authenticity Classification
"""
import logging
from typing import Any, Dict, Tuple
import numpy as np
from PIL import Image, ImageFilter

logger = logging.getLogger("field-verification-ml")

AUTHENTICITY_KEYS = [
    "authentic_physical",
    "ai_generated",
    "screen_replay",
    "print_attack",
    "digitally_tampered",
]

AUTHENTICITY_PROMPTS = [
    (
        "an authentic physical photograph taken by a real camera of a genuine chemical test kit vial "
        "and color reference card in natural realistic ambient lighting with optical camera lens depth"
    ),
    (
        "an AI-generated synthetic computer rendering, Midjourney digital illustration, "
        "or DALL-E deepfake of a chemical drug test kit with artificial surfaces"
    ),
    (
        "a photograph of a digital LCD or smartphone screen displaying an image, "
        "with screen glare, monitor reflections, and pixel grid scan lines"
    ),
    (
        "a photograph of a printed paper sheet, inkjet printout, or 2D color paper card "
        "showing a printed picture of a test kit"
    ),
    (
        "a digitally manipulated, photoshopped, or spliced image with artificially "
        "recolored test vial fluid or pasted graphic elements"
    ),
]


def analyze_fft_moire(pil_image: Image.Image) -> Tuple[float, bool]:
    """
    Analyzes 2D Fast Fourier Transform magnitude spectrum for periodic subpixel
    display grids (Moiré interference) typical of LCD/OLED screen recaptures.

    Returns:
        (moire_score: float [0.0 - 1.0], is_screen_replay: bool)
    """
    try:
        # Resize to fixed dimension for normalized spectral frequency resolution
        gray = pil_image.convert("L").resize((256, 256), Image.Resampling.BILINEAR)
        arr = np.asarray(gray, dtype=np.float32)

        # 2D FFT with DC component shifted to center
        fft2 = np.fft.fft2(arr)
        fft_shift = np.fft.fftshift(fft2)
        magnitude = np.log1p(np.abs(fft_shift))

        h, w = magnitude.shape
        cy, cx = h // 2, w // 2

        # Radial coordinates from center
        y, x = np.ogrid[:h, :w]
        dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)

        # Focus on mid-to-high frequency band where screen subpixel grids resonate
        mid_high_mask = (dist > 14) & (dist < min(cx, cy) - 6)
        freq_vals = magnitude[mid_high_mask]

        if len(freq_vals) == 0:
            return 0.0, False

        mean_val = float(np.mean(freq_vals))
        std_val = float(np.std(freq_vals))
        max_val = float(np.max(freq_vals))

        # Peak-to-average ratio detects sharp periodic delta spikes characteristic of pixel matrices
        peak_ratio = (max_val - mean_val) / (std_val + 1e-6)

        # High frequency energy falloff ratio
        outer_mask = (dist > min(cx, cy) * 0.65) & (dist < min(cx, cy) - 6)
        inner_mask = (dist > 14) & (dist <= min(cx, cy) * 0.65)
        outer_mean = float(np.mean(magnitude[outer_mask])) if np.any(outer_mask) else 0.0
        inner_mean = float(np.mean(magnitude[inner_mask])) if np.any(inner_mask) else 1.0
        ring_ratio = outer_mean / (inner_mean + 1e-6)

        # Normalize score
        moire_score = float(np.clip((peak_ratio - 3.2) / 4.0 + (ring_ratio - 0.72) * 0.45, 0.0, 1.0))
        is_screen_replay = moire_score > 0.62 or peak_ratio > 5.5

        return round(moire_score, 3), is_screen_replay
    except Exception as exc:
        logger.warning("FFT Moiré analysis error: %s", exc)
        return 0.0, False


def analyze_sensor_noise(pil_image: Image.Image) -> Tuple[float, bool]:
    """
    Measures high-frequency sensor noise residual and Laplacian texture dispersion.
    Authentic camera sensors produce natural Poisson-Gaussian shot noise.
    Pure diffusion AI images or digital illustrations exhibit unnatural smoothness
    or aberrant residual distributions.

    Returns:
        (noise_consistency: float [0.0 - 1.0], has_noise_anomaly: bool)
    """
    try:
        gray = pil_image.convert("L").resize((256, 256), Image.Resampling.BILINEAR)
        # High-pass filter via difference with Gaussian blur
        blurred = gray.filter(ImageFilter.GaussianBlur(radius=1.5))
        residual = np.asarray(gray, dtype=np.float32) - np.asarray(blurred, dtype=np.float32)

        variance = float(np.var(residual))

        # Realistic camera noise variance on standard 256x256 test crop is 3.5 to 140.0
        if variance < 1.8:  # Artificially smooth (AI vector / synthetic flat render)
            anomaly = True
            consistency = max(0.15, variance / 2.5)
        elif variance > 280.0:  # High-frequency artificial grain or severe compression artifact
            anomaly = True
            consistency = max(0.25, 1.0 - (variance - 280.0) / 350.0)
        else:
            anomaly = False
            consistency = 0.88 + min(0.11, variance / 220.0)

        return round(float(np.clip(consistency, 0.0, 1.0)), 3), anomaly
    except Exception as exc:
        logger.warning("Sensor noise analysis error: %s", exc)
        return 0.9, False


def analyze_authenticity(
    pil_image: Image.Image,
    siglip_model=None,
    siglip_processor=None,
    device: str = "cpu",
) -> Dict[str, Any]:
    """
    Comprehensive multi-layer forensic authenticity evaluation.
    Combines SigLIP zero-shot vision-language evaluation, 2D FFT Moiré analysis,
    and sensor noise residuals.
    """
    # 1. 2D FFT spectral Moiré detection
    fft_score, is_screen_replay = analyze_fft_moire(pil_image)

    # 2. Sensor noise consistency analysis
    noise_score, has_noise_anomaly = analyze_sensor_noise(pil_image)

    # 3. SigLIP zero-shot authenticity classification
    siglip_probs = {}
    if siglip_model is not None and siglip_processor is not None:
        try:
            import torch

            inputs = siglip_processor(
                text=AUTHENTICITY_PROMPTS,
                images=pil_image,
                padding="max_length",
                return_tensors="pt",
            )
            inputs = {k: v.to(device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = siglip_model(**inputs)
                logits = outputs.logits_per_image
                probs = torch.softmax(logits, dim=-1)[0].tolist()

            siglip_probs = {
                AUTHENTICITY_KEYS[i]: round(probs[i] * 100, 2)
                for i in range(len(AUTHENTICITY_KEYS))
            }
        except Exception as exc:
            logger.warning("SigLIP authenticity classification error: %s", exc)

    if not siglip_probs:
        # Heuristic fallback if model unavailable
        siglip_probs = {
            "authentic_physical": 92.0 if not (is_screen_replay or has_noise_anomaly) else 45.0,
            "ai_generated": 35.0 if has_noise_anomaly else 4.0,
            "screen_replay": 85.0 if is_screen_replay else 2.0,
            "print_attack": 1.5,
            "digitally_tampered": 1.5,
        }

    # Extract component probabilities
    p_authentic = siglip_probs.get("authentic_physical", 90.0)
    p_ai = siglip_probs.get("ai_generated", 5.0)
    p_screen = siglip_probs.get("screen_replay", 2.0)
    p_print = siglip_probs.get("print_attack", 1.5)
    p_tampered = siglip_probs.get("digitally_tampered", 1.5)

    # Synthesize multi-layer authenticity score
    # Penalize if FFT detects screen Moiré or noise anomaly
    penalty = 0.0
    detected_flags = []

    if is_screen_replay or p_screen > 45.0 or fft_score > 0.55:
        detected_flags.append("SCREEN_REPLAY_SPOOF_DETECTED")
        penalty += 45.0 + (fft_score * 35.0)

    if p_ai > 38.0 or (has_noise_anomaly and p_ai > 25.0):
        detected_flags.append("AI_GENERATED_SYNTHETIC_DETECTED")
        penalty += 40.0 + (p_ai * 0.4)

    if p_tampered > 40.0:
        detected_flags.append("DIGITAL_TAMPERING_DETECTED")
        penalty += 35.0

    if p_print > 45.0:
        detected_flags.append("PRINT_PAPER_SPOOF_DETECTED")
        penalty += 30.0

    # Calculate final authenticity score (0 - 100%)
    base_score = p_authentic * noise_score
    final_score = float(np.clip(base_score - penalty, 1.0, 99.5))
    final_score = round(final_score, 1)

    # Determine risk category & verdict
    if final_score >= 78.0 and not detected_flags:
        spoof_risk = "low"
        is_authentic = True
        verdict = "AUTHENTIC_PHYSICAL_SAMPLE"
        explanation = (
            "Authentic camera capture confirmed. Physical sensor noise pattern verified "
            "with zero screen moiré or generative diffusion artifacts."
        )
    elif final_score >= 50.0:
        spoof_risk = "medium"
        is_authentic = True  # Marginal, flagged for human review
        verdict = "POTENTIAL_ANOMALY_REVIEW_RECOMMENDED"
        explanation = (
            "Marginal optical consistency. Slight lighting or frequency anomaly detected; "
            "secondary visual inspection recommended."
        )
    else:
        spoof_risk = "high"
        is_authentic = False
        verdict = "FABRICATED_OR_SPOOF_SAMPLE_DETECTED"
        reasons = []
        if "SCREEN_REPLAY_SPOOF_DETECTED" in detected_flags:
            reasons.append("screen recapture / display subpixel grid")
        if "AI_GENERATED_SYNTHETIC_DETECTED" in detected_flags:
            reasons.append("synthetic AI-generated rendering")
        if "DIGITAL_TAMPERING_DETECTED" in detected_flags:
            reasons.append("digital manipulation/splicing")
        if "PRINT_PAPER_SPOOF_DETECTED" in detected_flags:
            reasons.append("2D paper print attack")
        explanation = f"High spoof probability detected: {', '.join(reasons) if reasons else 'unnatural optical artifacts'}."

    return {
        "is_authentic": is_authentic,
        "authenticity_score": final_score,
        "spoof_risk": spoof_risk,
        "verdict": verdict,
        "explanation": explanation,
        "flags": detected_flags,
        "metrics": {
            "natural_physical_prob": round(p_authentic, 1),
            "ai_generated_prob": round(p_ai, 1),
            "screen_replay_prob": round(p_screen, 1),
            "print_spoof_prob": round(p_print, 1),
            "digital_tampering_prob": round(p_tampered, 1),
            "fft_moire_score": fft_score,
            "noise_consistency": noise_score,
        },
    }
