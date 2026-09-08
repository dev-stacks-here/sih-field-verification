# Permanent Public Hosting Guide (100% Free / Static Hosting)

This guide walks you through permanently hosting the **Field Verification Platform** online with **zero server costs, zero Docker requirements, and zero credit card needed**.

---

## Overview: In-Browser Static Engine (Zero Server Cost)

Because many cloud providers charge for Docker or require credit card verification for container runtimes, this platform includes a **built-in In-Browser Static Engine** ([`frontend/src/staticEngine.js`](frontend/src/staticEngine.js)):

```
┌─────────────────────────────────────────────────────────────┐
│                 STATIC WEB APPLICATION                      │
│        Hosted on GitHub Pages / Render Static / Vercel      │
│                                                             │
│  ┌───────────────────────┐   ┌───────────────────────────┐  │
│  │ HTML5 Camera & Canvas │   │ WebCrypto Tamper-Evidence │  │
│  │ Real-time viewfinder  │   │ SHA-256 + HMAC digital    │  │
│  │ + Reference Card Box  │   │ signatures                │  │
│  └──────────┬────────────┘   └─────────────▲─────────────┘  │
│             │                              │                │
│             ▼                              │                │
│  ┌───────────────────────┐   ┌─────────────┴─────────────┐  │
│  │ Calibrated Vision     │   │ Local Audit Vault         │  │
│  │ Grey-world balance &  │──▶│ IndexedDB / LocalStorage  │  │
│  │ Hue reaction engine   │   │ + Password Auth Deletion  │  │
│  └───────────────────────┘   └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### What runs in Static Mode:
- **Zero-Server Camera Capture**: Accesses device camera or fallback simulated capture with real-time alignment guide.
- **Calibrated Vision Engine**: Performs in-memory HTML5 Canvas grey-world white-balance calibration and HSV colorimetric classification (Positive / Negative / Inconclusive).
- **Forensic Anti-Spoofing & AI Detection**: Performs high-frequency Moiré pattern detection, screen recapture grid analysis, and sensor noise texture dispersion checks.
- **Tamper-Evident Signatures**: Uses the browser's native `crypto.subtle` (Web Crypto API) to compute SHA-256 hashes and digital signatures.
- **Audit Vault & Deletion**: Complete search, filter, and zero-retention password-protected record deletion.
- **Dual-Mode Sync**: If a backend API is later provided via `VITE_API_BASE_URL`, the app automatically connects to it; otherwise it operates standalone.

---

## Hosting Method 1: GitHub Pages (100% Free, Zero Config)

GitHub Pages hosts your static site directly from your repository for free with automated HTTPS:

1. Open your repository on GitHub: [`https://github.com/dev-stacks-here/sih-field-verification`](https://github.com/dev-stacks-here/sih-field-verification).
2. Click **Settings** (top tab) -> **Pages** (left sidebar under "Code and automation").
3. Under **Build and deployment**:
   - Change **Source** from "Deploy from a branch" to **GitHub Actions**.
4. That's it! The included workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) will automatically build and publish your site whenever you push to `main`.
5. Your permanent public HTTPS URL will be:
   ```
   https://dev-stacks-here.github.io/sih-field-verification/
   ```

---

## Hosting Method 2: Render Static Site (100% Free, No Credit Card)

Render Static Sites are **completely free** (unlike Docker web services):

1. Go to [Render Dashboard](https://dashboard.render.com/) and sign in with GitHub.
2. Click **New +** -> **Static Site**.
3. Select your repository: `dev-stacks-here/sih-field-verification`.
4. Configure the build settings:
   - **Name**: `field-verification` (or any name)
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
5. Click **Create Static Site**.
6. Render will automatically build the site and provide a permanent HTTPS URL like:
   ```
   https://field-verification.onrender.com
   ```
*(Alternatively, click **New +** -> **Blueprint**; the included [`render.yaml`](render.yaml) is pre-configured to deploy this static site automatically).*

---

## Hosting Method 3: Vercel (100% Free, Instant Global CDN)

Vercel provides instant edge deployment with automated SSL:

1. Go to [Vercel Dashboard](https://vercel.com/dashboard) and sign in.
2. Click **Add New...** -> **Project**.
3. Import `dev-stacks-here/sih-field-verification`.
4. In Project Settings:
   - **Root Directory**: Click "Edit" and select `frontend`.
   - **Framework Preset**: `Vite`.
   - **Build Command**: `npm run build`.
   - **Output Directory**: `dist`.
5. Click **Deploy**.
6. Vercel provisions a fast, permanent HTTPS URL like:
   ```
   https://sih-field-verification.vercel.app
   ```

---

## Hosting Method 4: Netlify (100% Free)

1. Go to [Netlify Dashboard](https://app.netlify.com/).
2. Click **Add new site** -> **Import an existing project** -> **GitHub**.
3. Select `dev-stacks-here/sih-field-verification`.
4. Base directory: `frontend` | Build command: `npm run build` | Publish directory: `dist`.
5. Click **Deploy**.

---

## Operator Sign-In Credentials (Static Mode)

When visiting the live static website, you can sign in using either of the pre-configured operator accounts:

| Operator ID | Password | Role | Station |
| :--- | :--- | :--- | :--- |
| **`OP-4401`** | **`fieldpass123`** | Officer A. Verma | Zone 4 Narcotics Unit |
| **`R.SHARMA`** | **`Field@123`** | Inspector R. Sharma | Patrol Unit 7 |

*Note: You can also enter any custom Operator ID with a password (minimum 4 characters), and the in-browser vault will register and authenticate you locally.*

---

## Optional: Self-Hosted Docker (If You Have a VPS)

If you ever decide to host on a private Linux VPS or dedicated server where Docker is available:

```bash
git clone https://github.com/dev-stacks-here/sih-field-verification.git
cd sih-field-verification
docker compose up -d --build
```
This boots the full stack (`frontend` on port 80, `backend` on port 4000, and `ml-service` on port 8000).
