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
with natural-language prompts (see `LABELS` in `classifier.py`) with zero
additional training — a reasonable fit for a prototype where the real
production step (once a kit manufacturer's reference colour chart is
available) would be to fine-tune or calibrate thresholds against that
chart, not to train a classifier from scratch.

## Accuracy — how to get a real number, not just a design rationale

"Zero-shot, no training" is an honest answer to *why* there's no accuracy
figure yet, but it isn't an accuracy figure. Two scripts close that gap:

**1. `evaluate.py` — the actual measurement tool.**
Point it at a folder of labelled photos (`data/positive/`, `data/negative/`,
`data/inconclusive/`, each full of real photos of the kit at a known,
confirmed outcome) and it reports accuracy plus a confusion matrix, and
writes a JSON report you can cite directly:

```bash
python evaluate.py --data-dir data --out report.json
```

Before demo day, take 10-20 photos per category of the real kit at known
outcomes (spike a sample, run the test, confirm the result some other way,
photograph it through the app's own capture flow so lighting/framing match
real use) and run this. That's the number to put on a slide — not CLIP's
general benchmark numbers, which say nothing about this kit.

**2. `generate_synthetic_dataset.py` — a stand-in until you have real photos.**
Renders procedural colour-patch images in the same layout as a real capture,
purely so `evaluate.py` and its report format are runnable and demoable
*today*. It is explicitly **not** a source of real accuracy — synthetic hue
patches aren't real chemistry — but it proves the harness works and gives
you the exact folder structure to drop real photos into later:

```bash
python generate_synthetic_dataset.py --out synthetic_data --per-category 12
python evaluate.py --data-dir synthetic_data --out synthetic_report.json
```

**3. The feedback loop built into the app itself.**
Every scan record can later be marked with a `confirmed_result` (see
`PATCH /api/scans/:recordId/confirm` in the backend) once a lab or
supervisor confirms the true outcome — deliberately stored outside the
signed payload, so confirming a result later can never alter what was
signed at capture time. `GET /api/scans/stats/accuracy` aggregates all
confirmed scans into a live accuracy/confusion-matrix report, split by
which classifier (`pretrained-clip` vs `heuristic`) produced the result.
This is the honest long-term answer: the system is designed to *build* a
real accuracy track record from actual field use, not to claim one it
doesn't have yet.
