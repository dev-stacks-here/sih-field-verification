"""
Generates a small synthetic labelled dataset so evaluate.py's pipeline can
be run and demonstrated before real kit photos exist.

IMPORTANT - what this is and isn't for
---------------------------------------
These images are procedurally rendered colour patches, not real chemistry.
An accuracy number from this synthetic set tells you the evaluation harness
and CLIP prompts work end-to-end - it is NOT a claim about real-world
accuracy on the actual kit, and should never be presented to judges as one.
Its purpose is to make evaluate.py runnable and its output format concrete
today, and to give you a folder structure to replace with real photos once
you have them (same layout: data/<category>/*.jpg).

Usage:
    python generate_synthetic_dataset.py --out synthetic_data --per-category 12
    python evaluate.py --data-dir synthetic_data --out synthetic_report.json
"""
import argparse
import colorsys
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# Rough hue ranges (degrees, 0-360) standing in for each category, loosely
# matching the bucket logic in backend/src/utils/colorAnalysis.js. Real
# kits will have their own documented bands - swap these out once you have
# the manufacturer's reference chart.
HUE_RANGES = {
    "positive": (300, 340),       # magenta/pink
    "negative": (90, 160),        # green/blue-green
    "inconclusive": (0, 360),     # random / low-saturation, handled specially below
}


def render_vial_card_frame(category: str, seed: int) -> Image.Image:
    rng = random.Random(seed)
    w, h = 480, 640
    img = Image.new("RGB", (w, h), (18, 22, 27))
    draw = ImageDraw.Draw(img)

    # Vial zone (left half of the guide) and card zone (right half),
    # mirroring the layout in App.jsx's capture guide.
    top, height = int(h * 0.32), int(h * 0.26)
    left, right = int(w * 0.10), int(w * 0.90)
    mid = (left + right) // 2

    if category == "inconclusive":
        sat = rng.uniform(0.0, 0.12)
        hue = rng.uniform(0, 360)
    else:
        lo, hi = HUE_RANGES[category]
        hue = rng.uniform(lo, hi)
        sat = rng.uniform(0.45, 0.85)
    val = rng.uniform(0.55, 0.9)
    r, g, b = [int(c * 255) for c in colorsys.hsv_to_rgb(hue / 360, sat, val)]

    # Slight per-image lighting tint applied to BOTH zones, to simulate
    # varying field lighting conditions - the reference card exists
    # precisely so this can be corrected for.
    tint = rng.uniform(0.85, 1.15)
    vial_color = (min(255, int(r * tint)), min(255, int(g * tint)), min(255, int(b * tint)))
    card_color = (min(255, int(210 * tint)), min(255, int(210 * tint)), min(255, int(210 * tint)))

    draw.rounded_rectangle([left, top, mid - 6, top + height], radius=14, fill=vial_color)
    draw.rounded_rectangle([mid + 6, top, right, top + height], radius=14, fill=card_color)

    img = img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0, 1.2)))
    # Mild sensor-noise stand-in.
    noise = Image.effect_noise((w, h), rng.uniform(2, 8)).convert("RGB")
    img = Image.blend(img, noise, alpha=0.03)
    return img


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("synthetic_data"))
    parser.add_argument("--per-category", type=int, default=12)
    args = parser.parse_args()

    for category in HUE_RANGES:
        folder = args.out / category
        folder.mkdir(parents=True, exist_ok=True)
        for i in range(args.per_category):
            img = render_vial_card_frame(category, seed=hash((category, i)) & 0xFFFFFFFF)
            img.save(folder / f"synthetic_{i:03d}.jpg", quality=90)
        print(f"Wrote {args.per_category} synthetic images to {folder}/")

    print(
        f"\nDone. This is a SYNTHETIC smoke-test set, not real kit photos - "
        f"see the module docstring. Run:\n"
        f"  python evaluate.py --data-dir {args.out} --out synthetic_report.json"
    )


if __name__ == "__main__":
    main()
