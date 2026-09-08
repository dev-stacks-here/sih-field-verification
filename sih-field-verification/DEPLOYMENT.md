# Permanent Public Hosting & Deployment Guide

This guide provides end-to-end instructions for permanently hosting the **Field Verification Platform** online with public HTTPS access, automated SSL certificates, and continuous deployment.

---

## Architecture Overview

The system consists of three decoupled components:

```
┌─────────────────────────────────┐
│     User Browser / Mobile       │
│  (Camera capture requires HTTPS)│
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│    Frontend SPA (Vite/React)    │
│  Vercel / Render Static Site    │
└──────────────┬──────────────────┘
               │ REST API / Uploads
               ▼
┌─────────────────────────────────┐
│   Backend API (Node Express)    │
│  Render Web Service / Docker    │
│   (SQLite + Ed25519 Keys)       │
└──────────────┬──────────────────┘
               │ Zero-Shot & Anti-Spoofing
               ▼
┌─────────────────────────────────┐
│    ML Vision Service (FastAPI)  │
│  Hugging Face Spaces (16GB RAM) │
│   (SigLIP + 2D FFT Forensic)    │
└─────────────────────────────────┘
```

> [!IMPORTANT]
> **HTTPS is Required for Camera Access:**
> Modern mobile and desktop browsers (`Chrome`, `Safari`, `Edge`, `Firefox`) **strictly block** webcam/camera access (`navigator.mediaDevices.getUserMedia`) on unencrypted HTTP connections (except `localhost`). All deployment paths below provide free, automated SSL/TLS (HTTPS) certificates.

---

## Strategy 1: 100% Free Forever Cloud Hosting (Recommended)

This strategy combines three generous free tiers to run the entire system forever at zero cost without entering a credit card:

| Service | Host | Free Tier Specs | URL Scheme |
| :--- | :--- | :--- | :--- |
| **ML Vision Service** | **Hugging Face Spaces** | **16 GB RAM**, 2 vCPUs | `https://<username>-sih-field-ml.hf.space` |
| **Backend API** | **Render** | 512 MB RAM, free Web Service | `https://sih-field-backend.onrender.com` |
| **Frontend UI** | **Render** or **Vercel** | Free global edge CDN | `https://sih-field-verification.vercel.app` |

---

### Step 1: Deploy ML Service on Hugging Face Spaces (Free 16 GB RAM)

Because Google SigLIP + PyTorch uses ~1.5 GB RAM, Hugging Face Spaces is the ideal zero-cost host (giving you 16 GB RAM free):

1. Go to [Hugging Face Spaces](https://huggingface.co/spaces) and click **Create new Space**.
2. Set Space Name: `sih-field-ml` (or any name you prefer).
3. Select **Space SDK**: **Docker** -> **Blank**.
4. Set Space Hardware: **CPU Basic (2 vCPU, 16 GB RAM - Free)**.
5. Set Space Visibility: **Public**.
6. Upload or push the files from the [`ml-service/`](file:///C:/Users/Arnav/OneDrive/Desktop/MUJ/sih-field-verification-main/sih-field-verification-main/sih-field-verification/ml-service) folder into your new Hugging Face Space repository:
   - `Dockerfile`
   - `requirements.txt`
   - `app.py`
   - `classifier.py`
   - `authenticity.py`
7. Hugging Face will automatically build the Docker container and start FastAPI on port `7860`.
8. Once built, copy your public Space URL (click the three dots in top-right -> **Embed this Space** -> copy direct URL, e.g.):
   ```
   https://<your-username>-sih-field-ml.hf.space
   ```
9. Verify by opening `https://<your-username>-sih-field-ml.hf.space/status` in your browser. You should see `{"status":"ok"}`.

---

### Step 2: Deploy Backend & Frontend on Render (1-Click Blueprint)

The repository includes a ready-to-use [`render.yaml`](file:///C:/Users/Arnav/OneDrive/Desktop/MUJ/sih-field-verification-main/sih-field-verification-main/sih-field-verification/render.yaml) blueprint that provisions both the Backend Web Service and Frontend Static Site:

1. Go to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Blueprint**.
3. Connect your GitHub repository: `dev-stacks-here/sih-field-verification`.
4. Render will automatically read `render.yaml` and configure two services:
   - `field-verification-backend` (Node.js web service)
   - `field-verification-frontend` (Vite static website)
5. Fill in the environment variable prompt:
   - **`ML_SERVICE_URL`**: Paste your Hugging Face Space URL from Step 1 (e.g. `https://<your-username>-sih-field-ml.hf.space`).
   - `JWT_SECRET` is generated automatically.
6. Click **Apply**.
7. Render will build both services. Once finished, Render gives you:
   - Backend URL: `https://field-verification-backend.onrender.com`
   - Frontend URL: `https://field-verification-frontend.onrender.com`

---

### Alternative Step 2B: Deploy Frontend on Vercel

If you prefer Vercel for the frontend:

1. Go to [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New** -> **Project**.
2. Import `dev-stacks-here/sih-field-verification`.
3. In Project Settings:
   - **Root Directory**: Select `frontend`.
   - **Framework Preset**: `Vite`.
   - **Build Command**: `npm run build`.
   - **Output Directory**: `dist`.
4. Add Environment Variable:
   - Name: `VITE_API_BASE_URL`
   - Value: `https://field-verification-backend.onrender.com/api` (your deployed Render backend URL).
5. Click **Deploy**. Vercel will assign a production domain like `https://sih-field-verification.vercel.app`.

---

## Strategy 2: Self-Hosted Docker Compose on VPS / Cloud VM

For private instances or dedicated infrastructure (DigitalOcean, AWS EC2, Hetzner, Linode, Oracle Cloud Free Tier):

### 1. Requirements
- Any Linux server with Docker and Docker Compose v2 installed.
- Open incoming ports: `80` (HTTP) and `443` (HTTPS) or `4000`/`8000` for testing.

### 2. Launch Stack

Clone the repository and run Docker Compose:

```bash
git clone https://github.com/dev-stacks-here/sih-field-verification.git
cd sih-field-verification

# Build and start all 3 services in background
docker compose up -d --build
```

Docker Compose spins up:
- **`fvs-frontend`**: Serves React SPA and reverse proxies `/api/` on port `80`.
- **`fvs-backend`**: Node.js API with persistent SQLite database volume on port `4000`.
- **`fvs-ml-service`**: FastAPI with SigLIP & 2D FFT anti-spoofing on port `8000`.

### 3. Automated Free SSL via Caddy (2 Lines)

To enable HTTPS on your domain (e.g. `verify.yourdomain.com`), install Caddy or use this `Caddyfile`:

```caddyfile
verify.yourdomain.com {
    reverse_proxy localhost:80
}
```

Run `caddy run`. Caddy will automatically obtain and renew free Let's Encrypt certificates.

---

## Environment Variables Reference

### Backend Service (`backend/`)
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `4000` | Port for Express API server |
| `JWT_SECRET` | *(Required)* | Secret key for signing operator JWT sessions |
| `ML_SERVICE_URL` | `http://localhost:8000` | Public or internal URL of the ML service |
| `ML_SERVICE_TIMEOUT_MS` | `15000` | Max milliseconds to wait for ML inference |
| `FRONTEND_URL` | `*` | Allowed CORS origins for frontend domain |
| `DB_PATH` | `./data/field_verification.db` | File path to SQLite database |
| `UPLOADS_DIR` | `./uploads` | Storage directory for captured scan photos |

### Frontend Service (`frontend/`)
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | `/api` | Base URL of backend API (e.g. `https://api.domain.com/api`) |

### ML Service (`ml-service/`)
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `7860` (or `8000`) | Port for FastAPI / Uvicorn |
| `CUSTOM_MODEL_PATH` | `./models/custom_classifier.pt` | Path to optional supervised CNN weights |
| `ENSEMBLE_WEIGHT_M1` | `0.40` | SigLIP Foundation model weight |
| `ENSEMBLE_WEIGHT_M2` | `0.60` | Custom model weight |

---

## Post-Deployment Verification Checklist

After launching, perform these verification steps:

- [ ] **Backend Health Check**: Open `https://<backend-url>/api/health`. Response should be `{"status":"ok","service":"field-verification-backend"}`.
- [ ] **ML Status Check**: Open `https://<ml-url>/status`. Response should show `status: "ok"`, `device: "cpu"`, and `google/siglip-base-patch16-224` loaded.
- [ ] **Operator Login**:
  - URL: `https://<frontend-url>`
  - Default User ID: `OP-4401`
  - Default Password: `fieldpass123`
- [ ] **Camera Access & Field Scan**:
  - Click **Start Field Scan**.
  - Browser should prompt for camera permissions and display the live viewfinder.
- [ ] **Dual-Model & Anti-Spoofing Verification**:
  - Perform a scan. The system will crop the vial, query SigLIP + 2D FFT Moiré anti-spoofing, and display the tamper-evident Ed25519 signature.
- [ ] **Secure Deletion Verification**:
  - In the **Scans** tab, delete a scan using your operator password (`fieldpass123`) to confirm zero-retention password verification.
