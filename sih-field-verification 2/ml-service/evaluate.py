"""
Evaluates the pretrained CLIP classifier against a labelled folder of
images and reports real accuracy + a confusion matrix, instead of citing
CLIP's general-purpose benchmark numbers as if they applied to this kit.

WHY THIS EXISTS
----------------
Before this script, the honest answer to "what's your model's accuracy?"
was "we don't have one - there's no labelled dataset of this kit's actual
colour reactions." That's a real gap, not something code alone can fix -
you still need real photos of the kit at known outcomes. What this script
does is remove every other excuse: point it at a folder of photos you (or
your team, or the kit vendor) have taken and labelled, and it gives you an
accuracy figure and confusion matrix you can put on a slide, in minutes.

Until you have real kit photos, use generate_synthetic_dataset.py to build
a synthetic set and smoke-test the pipeline end-to-end (it will NOT tell
you real-world accuracy - synthetic colour patches are not real chemistry -
but it proves the evaluation harness itself works and gives you a template
folder structure to drop real photos into).

USAGE
-----
Build (or generate) a folder like:

    data/
      positive/      *.jpg photos of confirmed positive reactions
      negative/      *.jpg photos of confirmed negative reactions
      inconclusive/  *.jpg photos of confirmed inconclusive/ambiguous cases

Then:

    python evaluate.py --data-dir data --out report.json

This prints accuracy + a confusion matrix to the console and writes the
same, plus every per-image prediction, to report.json for a slide/appendix.
"""
import argparse
import json
import sys
import time
from pathlib import Path

from PIL import Image

import classifier

CATEGORIES = classifier.CATEGORY_KEYS
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def load_labelled_images(data_dir: Path):
    items = []
    for category in CATEGORIES:
        folder = data_dir / category
        if not folder.is_dir():
            continue
        for path in sorted(folder.iterdir()):
            if path.suffix.lower() in IMAGE_EXTS:
                items.append((path, category))
    return items


def evaluate(data_dir: Path):
    items = load_labelled_images(data_dir)
    if not items:
        print(
            f"No labelled images found under {data_dir}. Expected subfolders: "
            f"{', '.join(CATEGORIES)}, each containing photos of that outcome.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Loading model... (first run downloads {classifier.MODEL_NAME})")
    classifier.load_model()

    confusion = {actual: {predicted: 0 for predicted in CATEGORIES} for actual in CATEGORIES}
    predictions = []
    correct = 0
    start = time.time()

    for path, actual in items:
        try:
            img = Image.open(path).convert("RGB")
            result = classifier.classify_image(img)
        except Exception as exc:
            print(f"  ! skipped {path.name}: {exc}", file=sys.stderr)
            continue
        predicted = result["category"]
        confusion[actual][predicted] += 1
        is_correct = predicted == actual
        correct += int(is_correct)
        predictions.append({
            "file": str(path),
            "actual": actual,
            "predicted": predicted,
            "confidence": result["confidence"],
            "correct": is_correct,
        })
        mark = "✓" if is_correct else "✗"
        print(f"  {mark} {path.name}: actual={actual} predicted={predicted} ({result['confidence']:.1f}%)")

    total = len(predictions)
    accuracy = (correct / total * 100) if total else 0.0
    elapsed = time.time() - start

    print("\n=== Confusion matrix (rows = actual, columns = predicted) ===")
    header = "actual\\predicted".ljust(16) + "".join(c.ljust(14) for c in CATEGORIES)
    print(header)
    for actual in CATEGORIES:
        row = actual.ljust(16) + "".join(str(confusion[actual][p]).ljust(14) for p in CATEGORIES)
        print(row)

    print(f"\nAccuracy: {correct}/{total} = {accuracy:.1f}%")
    print(f"Evaluated in {elapsed:.1f}s ({elapsed / total:.2f}s/image)" if total else "")

    return {
        "model": classifier.MODEL_NAME,
        "dataDir": str(data_dir),
        "totalImages": total,
        "correct": correct,
        "accuracy": round(accuracy, 1),
        "confusionMatrix": confusion,
        "predictions": predictions,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=Path("data"),
                         help="Folder with positive/negative/inconclusive subfolders of labelled photos.")
    parser.add_argument("--out", type=Path, default=Path("report.json"),
                         help="Where to write the full JSON report.")
    args = parser.parse_args()

    report = evaluate(args.data_dir)
    args.out.write_text(json.dumps(report, indent=2))
    print(f"\nFull report written to {args.out}")


if __name__ == "__main__":
    main()
