# ML Service — Dual-Model Vision Classifier

A FastAPI microservice that classifies a cropped test-vial image into `positive` / `negative` / `inconclusive` using a **Dual-Model Ensemble Architecture**:

1. **Model 1 (Foundation Model — Google SigLIP `google/siglip-base-patch16-224`)**:
   - Zero-shot classification against natural-language prompts.
   - Pretrained on millions of image-text pairs with sigmoid loss for superior color sensitivity.
   - Operates out of the box with **zero training required** and lightweight resource usage (~400MB, sub-300ms on CPU).
2. **Model 2 (Custom Domain Classifier — PyTorch CNN)**:
   - Domain-specific model trained specifically on confirmed chemical test kit photos.
   - Loaded dynamically from `models/custom_classifier.pt` when trained.
   - If not yet trained, the service operates seamlessly on SigLIP alone without interruption.
3. **Ensemble & Forensic Verification Engine**:
   - When Model 2 is present, predictions are weighted (`0.4 * SigLIP + 0.6 * Custom`).
   - If Model 1 and Model 2 disagree, the system flags `disagreement = true`, instructing the Node backend to mark the scan for human supervisor review (`needsReview = true`).

---

## Setup

```bash
cd ml-service
python -m venv .venv
# Activate virtualenv:
.venv\Scripts\activate      # Windows PowerShell/CMD
# source .venv/bin/activate  # Linux/macOS

pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

* First boot downloads the pretrained SigLIP weights (~400MB) from Hugging Face and caches them locally.
* CPU-only execution is fast (~150–300 ms per image). If an NVIDIA GPU is detected, CUDA is used automatically.

Connect the Node backend by setting `backend/.env`:
```env
ML_SERVICE_URL=http://localhost:8000
```

---

## API Endpoints

### `POST /classify`
Multipart form upload with field `image` (JPEG/PNG bytes of the cropped vial).

**Response (Ensemble Active):**
```json
{
  "category": "positive",
  "confidence": 92.4,
  "scores": { "positive": 92.4, "negative": 4.1, "inconclusive": 3.5 },
  "model": "google/siglip-base-patch16-224 + custom-vial-classifier",
  "method": "dual-model-ensemble",
  "ensemble": {
    "active": true,
    "disagreement": false,
    "consensus": true,
    "model1": {
      "name": "google/siglip-base-patch16-224",
      "category": "positive",
      "confidence": 89.2
    },
    "model2": {
      "name": "custom-vial-classifier",
      "category": "positive",
      "confidence": 94.5
    }
  }
}
```

### `GET /health`
Returns operational status for both Model 1, Model 2, device, and active ensemble state.

---

## Training Model 2 (Custom Domain Classifier)

Whenever you have confirmed photos of your test kits (e.g. from field tests, laboratory verifications, or kit trials):

1. Organize your labeled photos in class subdirectories:
   ```
   data/
     positive/      *.jpg (confirmed positive reactions)
     negative/      *.jpg (confirmed negative reactions)
     inconclusive/  *.jpg (ambiguous/inconclusive reactions)
   ```
2. Run the turnkey training script:
   ```bash
   python train_custom_model.py --data-dir data/ --epochs 15 --out models/custom_classifier.pt
   ```
3. Restart or reload the FastAPI service. It will automatically detect `models/custom_classifier.pt` and activate the dual-model ensemble!

---

## Accuracy Measurement & Evaluation

### 1. `evaluate.py` — Benchmark Tool
Evaluates the classifier against a labeled folder and produces an official confusion matrix and accuracy report:
```bash
python evaluate.py --data-dir data/ --out report.json
```
When Model 2 is loaded, it also measures the **Model Consensus Rate** between SigLIP and your custom model.

### 2. `generate_synthetic_dataset.py` — Smoke Test Harness
Renders procedurally generated color patches to verify your pipeline end-to-end before real photos are collected:
```bash
python generate_synthetic_dataset.py --out synthetic_data --per-category 10
python evaluate.py --data-dir synthetic_data --out synthetic_report.json
```
