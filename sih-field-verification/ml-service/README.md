# ML service — pretrained colour classifier

A small FastAPI microservice that classifies a cropped test-vial image into
`positive` / `negative` / `inconclusive` using a **pretrained** CLIP model
(`openai/clip-vit-base-patch32`) via zero-shot classification against
text prompts — no training step, no labelled dataset required.

The Node backend (`backend/src/utils/mlClassifier.js`) calls this service
for every scan and treats its answer as the primary server-side result. If
the service is unreachable or errors, the backend automatically falls back
to its own independent calibrated heuristic
(`backend/src/utils/colorAnalysis.js`), so the app keeps working even
without the ML service running (e.g. for a quick demo on a machine without
a GPU or without the Python deps installed).

## Setup

```bash
cd ml-service
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

First boot downloads the pretrained CLIP weights (~600MB) from Hugging Face
and takes a minute or two; after that it's cached locally and starts fast.
CPU-only is fine for a demo (a few hundred ms per classification); a GPU
speeds it up further if available.

Point the backend at it via `backend/.env`:

```
ML_SERVICE_URL=http://localhost:8000
```

## API

`POST /classify` — multipart form field `image` (JPEG/PNG bytes of the
cropped vial region) → `{ category, confidence, scores, model, method }`

`GET /health` — service + model status.

## Why zero-shot instead of training a model

There's no labelled dataset of this specific kit's positive/negative colour
reactions to train on, and a model trained on a handful of demo photos
would just memorise them rather than generalise. CLIP was pretrained on
hundreds of millions of image-text pairs and can be steered per-category
with natural-language prompts (see `LABELS` in `app.py`) with zero
additional training — a reasonable fit for a prototype where the real
production step (once a kit manufacturer's reference colour chart is
available) would be to fine-tune or calibrate thresholds against that
chart, not to train a classifier from scratch.
