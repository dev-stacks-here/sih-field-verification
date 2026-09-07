# Field Verification System

A prototype mobile/web app that pairs with existing colorimetric field drug-test
kits (no new hardware). It captures an image of the test result alongside a
reference colour card, classifies the outcome, and produces a signed,
tamper-evident digital record with timestamp, GPS location, and operator ID.

## What's implemented

- **Capture** — camera view with an on-screen guide for the vial + reference
  colour card (`frontend/src/App.jsx`, `ScanScreen`).
- **Classification, done three ways, on purpose:**
  - *On-device preview* (`classifyRegion` in `App.jsx`) — samples the vial and
    card zones from the captured frame, applies a grey-world colour
    correction using the card as the neutral reference, and buckets hue into
    positive / negative / inconclusive. This gives the operator instant
    feedback but **is never trusted as the record of truth**.
  - *Server-side, authoritative, pretrained model* (`ml-service/app.py` +
    `backend/src/utils/mlClassifier.js`) — a FastAPI microservice classifies
    the cropped vial region with a **pretrained CLIP model**
    (`openai/clip-vit-base-patch32`), zero-shot against text prompts
    describing each outcome category. No custom training or labelled
    dataset is involved — see `ml-service/README.md` for why. This is the
    primary source of the signed `result`.
  - *Server-side fallback, calibrated heuristic*
    (`backend/src/utils/colorAnalysis.js`) — if the ML service is
    unreachable, times out, or errors, the backend automatically falls back
    to a grey-world-calibrated hue-bucketing heuristic re-derived
    independently from the raw image bytes, so the app keeps working
    without the Python service running. Which method actually produced the
    result is recorded per scan (`classification_method`) for audit. If the
    client's on-device guess disagrees with whichever server method ran, or
    server confidence is low, the record is flagged `needsReview` instead of
    silently trusting either side.
- **Tamper-evident record** — for every scan the server stores a SHA-256 hash
  of the exact image bytes written to disk, and signs
  `(recordId | imageHash | capturedAt | operatorId | lat | lon | serverResult
  | clientResult | needsReview)` with an Ed25519 keypair
  (`backend/src/utils/signing.js`). `GET /api/scans/:id/verify` recomputes the
  hash from disk and re-checks the signature, so any post-hoc edit to the
  image or the record's fields is detectable.
- **Operator auth** — bcrypt-hashed passwords, JWTs, no hardcoded secret
  fallback (server refuses to boot without a real `JWT_SECRET`).
- **Simulated-location safeguard** — if GPS is unavailable, the app falls
  back to a manual/simulated coordinate but *requires the operator to
  explicitly acknowledge that* before the record can be signed, so a missing
  GPS fix can't silently masquerade as a real one.
- **Searchable log** — `GET /api/scans` supports free-text search and
  filtering by result / review status.
- **Ground-truth confirmation & accuracy tracking** — any scan can later be
  marked with a `confirmed_result` (lab confirmation or supervisor review)
  via `PATCH /api/scans/:recordId/confirm`, from the log screen in the UI.
  This is stored outside the signed payload, so confirming a result later
  never alters what was signed at capture time. `GET /api/scans/stats/accuracy`
  aggregates confirmed scans into a live accuracy/confusion-matrix report per
  classifier. `ml-service/evaluate.py` does the same thing offline against a
  labelled photo folder, for a number you can cite before real confirmations
  have accumulated — see `ml-service/README.md`.

## Project layout

```
backend/     Express + SQLite (better-sqlite3) API, Ed25519 signing, image storage
frontend/    React + Vite mobile-shell UI (camera capture, result, signed report, log)
ml-service/  FastAPI microservice: pretrained CLIP model, zero-shot vial classification
```

## Running it locally

Requires Node 18+ and Python 3.9+ (only if you want the pretrained-model
classifier — the app still runs without it, using the heuristic fallback).
This sandbox's `pip`/`npm install` are blocked by network policy (registry
403) — install on your own machine.

```bash
# ml-service (optional but recommended - see ml-service/README.md)
cd ml-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000     # http://localhost:8000

# backend, in a second terminal
cd backend
cp .env.example .env
# generate a real secret and put it in .env as JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install
npm run dev        # http://localhost:4000

# frontend, in a third terminal
cd frontend
cp .env.example .env
npm install
npm run dev         # http://localhost:5173
```

If `ml-service` isn't running, the backend logs a warning per scan and
transparently falls back to the offline heuristic — nothing else breaks.

On first boot the backend seeds a demo operator: **R.SHARMA / Field@123**.
Create real accounts with:

```bash
npm run seed -- OPERATOR_ID "Full Name" password "Station name"
```

Open `http://localhost:5173`, sign in, and use **New scan**. On a phone this
uses the real camera and GPS; in a desktop browser without camera/GPS
permissions it falls back to a simulated feed/location so the flow is still
demoable.

## Known limitations / what a judge will probe

- The primary classifier is a **pretrained CLIP model used zero-shot**
  (see `ml-service/README.md` for why no custom training was done). It
  wasn't trained on this specific kit's colour chart, so its category
  prompts are generic — a production version should tighten the prompts
  (or fine-tune) against the kit manufacturer's published reference colour
  bands. The calibrated heuristic fallback has the same limitation in the
  other direction: it's hand-tuned constants, not learned from data.
  Keeping both, and flagging disagreement between them, is the mitigation.
  **Before presenting this**, run `ml-service/evaluate.py` against a small
  set of real, labelled kit photos and cite that number — see
  `ml-service/README.md` → "Accuracy" for the exact steps and a synthetic
  fallback set to sanity-check the harness in the meantime.
- `needsReview` disagreement is judged at the *category* level (client sent
  one bucket, server computed another) because the client only sends its
  proposed category, not its raw sampled colour. A stricter version would
  have the client send its raw sampled RGB too, purely for audit, still
  never trusted for the result itself.
- The default seeded operator account and demo JWT flow are for local/demo
  use only — rotate/remove them before any real deployment.
- This produces a **presumptive result and supporting record only** — it
  does not replace laboratory confirmatory testing, and the UI says so on
  the login and report screens.
