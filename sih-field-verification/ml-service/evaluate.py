"""
Evaluates the vision classification engine (SigLIP zero-shot and dual-model ensemble)
against a labelled folder of images, reporting accuracy, confusion matrix, and model agreement.

USAGE:
    python evaluate.py --data-dir data/ --out report.json
"""
import argparse
import json
import sys
import time
from pathlib import Path

from PIL import Image

import classifier

CATEGORIES = classifier.CATEGORY_KEYS
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


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

    status = classifier.model_status()
    print(f"Loading models... (Model 1: {classifier.MODEL_NAME})")
    classifier.load_model()
    status = classifier.model_status()
    ensemble_active = status.get("ensemble_active", False)
    print(f"Operational Mode: {'Dual-Model Ensemble' if ensemble_active else 'Model 1 (SigLIP) Standalone'}")

    confusion = {actual: {predicted: 0 for predicted in CATEGORIES} for actual in CATEGORIES}
    predictions = []
    correct = 0
    consensus_count = 0
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

        ens_data = result.get("ensemble", {})
        has_consensus = ens_data.get("consensus", True)
        if has_consensus:
            consensus_count += 1

        pred_entry = {
            "file": str(path),
            "actual": actual,
            "predicted": predicted,
            "confidence": result["confidence"],
            "correct": is_correct,
            "method": result.get("method"),
            "ensemble": ens_data,
        }
        predictions.append(pred_entry)

        mark = "✓" if is_correct else "✗"
        extra = ""
        if ensemble_active:
            m1_cat = ens_data.get("model1", {}).get("category", "")
            m2_cat = ens_data.get("model2", {}).get("category", "")
            agree_flag = "AGREE" if has_consensus else "DISAGREE"
            extra = f" [M1:{m1_cat} M2:{m2_cat} => {agree_flag}]"

        print(f"  {mark} {path.name}: actual={actual} predicted={predicted} ({result['confidence']:.1f}%){extra}")

    total = len(predictions)
    accuracy = (correct / total * 100) if total else 0.0
    consensus_rate = (consensus_count / total * 100) if total else 100.0
    elapsed = time.time() - start

    print("\n=== Confusion matrix (rows = actual, columns = predicted) ===")
    header = "actual\\predicted".ljust(16) + "".join(c.ljust(14) for c in CATEGORIES)
    print(header)
    for actual in CATEGORIES:
        row = actual.ljust(16) + "".join(str(confusion[actual][p]).ljust(14) for p in CATEGORIES)
        print(row)

    print(f"\nAccuracy: {correct}/{total} = {accuracy:.1f}%")
    if ensemble_active:
        print(f"Model Consensus Rate: {consensus_count}/{total} = {consensus_rate:.1f}%")
    print(f"Evaluated in {elapsed:.1f}s ({elapsed / total:.2f}s/image)" if total else "")

    return {
        "model": classifier.MODEL_NAME,
        "mode": "dual-model-ensemble" if ensemble_active else "siglip-standalone",
        "ensembleActive": ensemble_active,
        "dataDir": str(data_dir),
        "totalImages": total,
        "correct": correct,
        "accuracy": round(accuracy, 1),
        "consensusRate": round(consensus_rate, 1) if ensemble_active else None,
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
