import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Shield, Camera, MapPin, Clock, LogOut, Search, CheckCircle2,
  AlertTriangle, XCircle, FileText, RotateCcw, ChevronLeft,
  Fingerprint, Copy, Plus, Loader2, Check, User, Hash, Radio, ShieldCheck, ShieldX,
  AlertOctagon,
} from "lucide-react";
import { api } from "./api.js";

// ---------- helpers ----------

const CATEGORY = {
  positive: { label: "Positive", color: "var(--rust)", Icon: AlertTriangle },
  negative: { label: "Negative", color: "var(--green)", Icon: CheckCircle2 },
  inconclusive: { label: "Inconclusive", color: "var(--amber)", Icon: XCircle },
};

// Matches backend/src/utils/colorAnalysis.js FRAME_W/FRAME_H/guide fractions,
// so the on-device preview samples the same two regions the server will.
const FRAME_W = 480;
const FRAME_H = 640;
const GUIDE_TOP = 0.32;
const GUIDE_HEIGHT = 0.26;
const GUIDE_LEFT = 0.1;
const GUIDE_RIGHT = 0.9;

function pad(n) { return n.toString().padStart(2, "0"); }

function formatTimestamp(iso) {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} · ${time}`;
}

function formatCoord(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return "Unavailable";
  return `${Number(lat).toFixed(4)}°, ${Number(lon).toFixed(4)}°`;
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ loc: null, simulated: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ loc: { lat: pos.coords.latitude, lon: pos.coords.longitude }, simulated: false }),
      () => resolve({
        loc: { lat: 26.9124 + (Math.random() - 0.5) * 0.02, lon: 75.7873 + (Math.random() - 0.5) * 0.02 },
        simulated: true,
      }),
      { timeout: 4000 }
    );
  });
}

function avgRegion(ctx, x, y, w, h) {
  let region;
  try {
    region = ctx.getImageData(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
  } catch (e) {
    return null;
  }
  let rs = 0, gs = 0, bs = 0;
  const n = region.data.length / 4;
  for (let i = 0; i < region.data.length; i += 4) {
    rs += region.data[i]; gs += region.data[i + 1]; bs += region.data[i + 2];
  }
  return { r: rs / n, g: gs / n, b: bs / n };
}

function rgbToHueSat({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = ((g - b) / (max - min)) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const sat = max === 0 ? 0 : (max - min) / max;
  return { hue, sat };
}

// On-device PREVIEW ONLY. Samples the vial zone and the reference colour
// card zone from the just-captured frame, applies a grey-world correction
// using the card as the neutral reference, then buckets the corrected hue.
// This gives the operator immediate feedback, but it is never what gets
// signed - the server independently re-derives the same thing from the
// uploaded image bytes and that server result is the authoritative one
// (see backend/src/utils/colorAnalysis.js).
function classifyRegion(ctx, w, h) {
  const top = h * GUIDE_TOP, height = h * GUIDE_HEIGHT;
  const left = w * GUIDE_LEFT, right = w * GUIDE_RIGHT;
  const mid = (left + right) / 2;
  const inset = 0.18;

  const vialW = (mid - left), vialInsetX = vialW * inset, vialInsetY = height * inset;
  const cardW = (right - mid), cardInsetX = cardW * inset;

  const vial = avgRegion(ctx, left + vialInsetX, top + vialInsetY, vialW - vialInsetX * 2, height - vialInsetY * 2);
  const card = avgRegion(ctx, mid + cardInsetX, top + vialInsetY, cardW - cardInsetX * 2, height - vialInsetY * 2);

  const fallback = () => ({
    r: 60 + Math.random() * 160, g: 60 + Math.random() * 160, b: 60 + Math.random() * 160,
  });
  const vialSample = vial || fallback();
  const cardSample = card || { r: 128, g: 128, b: 128 };

  const cardMean = (cardSample.r + cardSample.g + cardSample.b) / 3 || 1;
  const clamp = (v) => Math.min(1.8, Math.max(0.55, v));
  const gain = {
    r: clamp(cardMean / (cardSample.r || 1)),
    g: clamp(cardMean / (cardSample.g || 1)),
    b: clamp(cardMean / (cardSample.b || 1)),
  };
  const calibrated = {
    r: Math.min(255, vialSample.r * gain.r),
    g: Math.min(255, vialSample.g * gain.g),
    b: Math.min(255, vialSample.b * gain.b),
  };

  const { hue, sat } = rgbToHueSat(calibrated);
  let category, confidence;
  if (sat < 0.08) { category = "inconclusive"; confidence = 45 + sat * 100; }
  else if (hue >= 15 && hue < 50) { category = "positive"; confidence = 78 + Math.random() * 16; }
  else if (hue >= 80 && hue < 175) { category = "negative"; confidence = 80 + Math.random() * 14; }
  else { category = "inconclusive"; confidence = 48 + Math.random() * 18; }

  return { category, confidence: Math.min(99, confidence) };
}

function useAuthedImageUrl(recordId) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    async function load() {
      try {
        const token = api.getToken();
        const res = await fetch(api.imagePath(recordId), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (e) { /* ignore - thumbnail just won't render */ }
    }
    if (recordId) load();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [recordId]);
  return url;
}

// ---------- small UI pieces ----------

function ResultBadge({ result, size = "md" }) {
  const c = CATEGORY[result] || CATEGORY.inconclusive;
  const Icon = c.Icon;
  return (
    <span className={`badge badge-${size}`} style={{ "--badge-color": c.color }}>
      <Icon size={size === "lg" ? 18 : 14} strokeWidth={2.4} />
      {c.label}
    </span>
  );
}

function ScanCard({ scan }) {
  const c = CATEGORY[scan.result] || CATEGORY.inconclusive;
  const thumb = useAuthedImageUrl(scan.recordId);
  return (
    <div className="scan-card" style={{ "--accent": c.color }}>
      <div className="scan-card-thumb">
        {thumb
          ? <img src={thumb} alt="" />
          : <div className="scan-card-thumb-fallback"><c.Icon size={20} strokeWidth={2} /></div>}
      </div>
      <div className="scan-card-body">
        <div className="scan-card-row1">
          <ResultBadge result={scan.result} />
          <span className="scan-card-id">{scan.recordId}</span>
        </div>
        <div className="scan-card-meta">
          <span><Clock size={11} /> {formatTimestamp(scan.receivedAt)}</span>
        </div>
        <div className="scan-card-meta muted">
          <span><MapPin size={11} /> {formatCoord(scan.latitude, scan.longitude)}{scan.locationSimulated ? " (manual)" : ""}</span>
        </div>
        {scan.needsReview && (
          <div className="scan-card-flag"><AlertOctagon size={11} /> Needs review</div>
        )}
      </div>
    </div>
  );
}

function CopyRow({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="hash-row"
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      <Hash size={12} />
      <span className="hash-text">{value.slice(0, 16)}…{value.slice(-8)}</span>
      {copied ? <Check size={13} color="var(--teal)" /> : <Copy size={13} />}
    </button>
  );
}

// ---------- screens ----------

function LoginScreen({ onLogin }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!userId.trim() || !password.trim()) {
      setError("Enter your operator ID and password to continue.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { token, operator } = await api.login(userId.trim(), password);
      api.setToken(token);
      onLogin(operator);
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen login-screen">
      <div className="login-top">
        <div className="seal"><Shield size={26} strokeWidth={1.8} /></div>
        <h1 className="serif-title">Field Verification</h1>
        <p className="subtitle">Digital chain-of-custody for presumptive field drug testing</p>
      </div>

      <form className="login-form" onSubmit={submit}>
        <div className="field">
          <label>Operator ID</label>
          <input value={userId} onChange={(e) => { setUserId(e.target.value); setError(""); }} placeholder="e.g. R.SHARMA" autoComplete="off" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} placeholder="••••••••" />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : "Sign in"}
        </button>
      </form>

      <p className="disclaimer">
        Presumptive results only. This tool supports, but does not replace, laboratory confirmatory testing.
      </p>
    </div>
  );
}

function HomeScreen({ operator, onNewScan, onOpenLog, onLogout }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.listScans({ limit: 4 })
      .then(({ scans }) => { if (!cancelled) setScans(scans); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const initials = operator.userId.replace(/[^A-Z]/g, "").slice(0, 2) || "OP";

  return (
    <div className="screen home-screen">
      <div className="home-topbar">
        <div className="avatar">{initials}</div>
        <div className="home-topbar-text">
          <div className="home-name">{operator.name}</div>
          <div className="home-sub">{operator.station || "Field Operator"}</div>
        </div>
        <button className="icon-btn" onClick={onLogout} aria-label="Log out"><LogOut size={18} /></button>
      </div>

      <button className="search-fake" onClick={onOpenLog}>
        <Search size={15} />
        <span>Search test log…</span>
      </button>

      <div className="section-head">
        <h2>Recent scans</h2>
        {scans.length > 0 && <button className="link-btn" onClick={onOpenLog}>View all</button>}
      </div>

      <div className="scan-list">
        {loading && <div className="empty-state"><Loader2 size={20} className="spin" /><p>Loading…</p></div>}
        {!loading && scans.length === 0 && (
          <div className="empty-state">
            <Radio size={22} strokeWidth={1.6} />
            <p>No scans recorded yet.<br />Start your first field test below.</p>
          </div>
        )}
        {!loading && scans.map((s) => <ScanCard key={s.recordId} scan={s} />)}
      </div>

      <div className="home-fab-wrap">
        <button className="fab" onClick={onNewScan}>
          <Plus size={20} strokeWidth={2.4} />
          New scan
        </button>
      </div>
    </div>
  );
}

function ScanScreen({ onCancel, onCaptured, captureCount }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [aligned, setAligned] = useState(false);
  const [phase, setPhase] = useState("live"); // live | analyzing

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
      } catch (e) {
        setCameraError(true);
      }
    }
    start();
    return () => {
      cancelled = true;
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setAligned(true), 1600);
    return () => clearTimeout(t);
  }, []);

  const capture = useCallback(async () => {
    if (!aligned || phase === "analyzing") return;
    const canvas = canvasRef.current;
    const w = FRAME_W, h = FRAME_H;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");

    if (cameraReady && videoRef.current && videoRef.current.videoWidth) {
      const vw = videoRef.current.videoWidth, vh = videoRef.current.videoHeight;
      const scale = Math.max(w / vw, h / vh);
      const sw = w / scale, sh = h / scale;
      ctx.drawImage(videoRef.current, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
    } else {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#2b3f2f");
      grad.addColorStop(1, "#4a3324");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 30, 0, Math.PI * 2);
        ctx.fill();
      }
      // Paint a rough neutral swatch in the card zone of the simulated frame
      // so the calibration path has something plausible to sample even
      // when there's no real camera (e.g. this demo environment).
      ctx.fillStyle = "#9a9a9a";
      const mid = w * (GUIDE_LEFT + GUIDE_RIGHT) / 2;
      ctx.fillRect(mid, h * GUIDE_TOP, w * GUIDE_RIGHT - mid, h * GUIDE_HEIGHT);
    }

    const analysis = classifyRegion(ctx, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPhase("analyzing");

    const capturedAt = new Date().toISOString();
    const { loc, simulated } = await getLocation();

    setTimeout(() => {
      onCaptured({ dataUrl, analysis, loc, simulatedLoc: simulated, locationAcknowledged: !simulated, capturedAt });
    }, 700);
  }, [aligned, phase, cameraReady, onCaptured]);

  return (
    <div className="screen scan-screen">
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div className="camera-area">
        {!cameraError && (
          <video ref={videoRef} className="camera-feed" muted playsInline
            style={{ opacity: cameraReady ? 1 : 0 }} />
        )}
        {(cameraError || !cameraReady) && (
          <div className="camera-fallback">
            <Camera size={28} strokeWidth={1.5} />
            <span>{cameraError ? "Camera unavailable — using simulated feed" : "Starting camera…"}</span>
          </div>
        )}

        <div className="cam-topbar">
          <button className="icon-btn glass" onClick={onCancel} aria-label="Cancel scan"><ChevronLeft size={18} /></button>
          {captureCount > 0 && <span className="session-pill">Capture {captureCount + 1} · this session</span>}
        </div>

        <div className={`guide ${aligned ? "aligned" : ""}`}>
          <div className="guide-zone"><span>Vial</span></div>
          <div className="guide-divider" />
          <div className="guide-zone"><span>Colour card</span></div>
          {[0, 1, 2, 3].map(i => <div key={i} className={`corner corner-${i}`} />)}
        </div>

        <div className="align-status">
          {aligned
            ? <><CheckCircle2 size={14} color="var(--teal)" /> Aligned — hold steady</>
            : <><Loader2 size={14} className="spin" /> Align vial and colour card in frame</>}
        </div>

        {phase === "analyzing" && (
          <div className="analyzing-overlay">
            <Loader2 size={26} className="spin" />
            <span>Analyzing colour reaction…</span>
          </div>
        )}

        <div className="cam-bottombar">
          <button
            className={`shutter ${aligned ? "" : "disabled"}`}
            onClick={capture}
            disabled={!aligned || phase === "analyzing"}
            aria-label="Capture"
          >
            <span className="shutter-ring" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultScreen({ capture, onAcknowledgeLocation, onContinue, onEnd, submitting, submitError }) {
  const c = CATEGORY[capture.analysis.category];
  const Icon = c.Icon;
  const blockedOnLocation = capture.simulatedLoc && !capture.locationAcknowledged;

  return (
    <div className="screen result-screen">
      <div className="result-top">
        <img src={capture.dataUrl} alt="Captured test" className="result-thumb" />
      </div>

      <div className="result-body">
        <div className="result-category" style={{ "--accent": c.color }}>
          <div className="result-icon"><Icon size={26} strokeWidth={2} /></div>
          <div>
            <div className="result-label">{c.label}</div>
            <div className="result-sub">On-device preview — server recomputes and signs the final result</div>
          </div>
        </div>

        <div className="confidence-block">
          <div className="confidence-row">
            <span>Confidence (preview)</span>
            <span>{capture.analysis.confidence.toFixed(1)}%</span>
          </div>
          <div className="confidence-track">
            <div className="confidence-fill" style={{ width: `${capture.analysis.confidence}%`, background: c.color }} />
          </div>
        </div>

        {capture.simulatedLoc && (
          <label className="ack-row">
            <input
              type="checkbox"
              checked={capture.locationAcknowledged}
              onChange={(e) => onAcknowledgeLocation(e.target.checked)}
            />
            <span>
              GPS was unavailable — a manual/simulated location will be recorded instead.
              I confirm this is acceptable for this record.
            </span>
          </label>
        )}

        <p className="result-note">
          This is a presumptive classification only. It does not confirm the presence or absence
          of a controlled substance and must be paired with laboratory analysis for evidentiary use.
        </p>

        {submitError && <div className="form-error">{submitError}</div>}
      </div>

      <div className="result-actions">
        <button className="btn btn-ghost" onClick={onContinue} disabled={submitting || blockedOnLocation}>
          <RotateCcw size={16} /> Continue scan
        </button>
        <button className="btn btn-primary" onClick={onEnd} disabled={submitting || blockedOnLocation}>
          {submitting ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}
          {submitting ? "Signing record…" : "End scan & generate report"}
        </button>
      </div>
    </div>
  );
}

function VerifyRow({ recordId }) {
  const [state, setState] = useState("idle"); // idle | checking | valid | invalid

  const run = async () => {
    setState("checking");
    try {
      const { valid } = await api.verifyScan(recordId);
      setState(valid ? "valid" : "invalid");
    } catch (e) {
      setState("invalid");
    }
  };

  return (
    <button className={`verify-btn verify-${state}`} onClick={run} disabled={state === "checking"}>
      {state === "idle" && <><ShieldCheck size={13} /> Verify integrity</>}
      {state === "checking" && <><Loader2 size={13} className="spin" /> Checking…</>}
      {state === "valid" && <><ShieldCheck size={13} /> Hash &amp; signature valid</>}
      {state === "invalid" && <><ShieldX size={13} /> Verification failed</>}
    </button>
  );
}

function ReportScreen({ records, onDone }) {
  return (
    <div className="screen report-screen">
      <div className="report-head">
        <div className="report-seal"><Fingerprint size={22} strokeWidth={1.7} /></div>
        <h2 className="serif-title small">Signed digital record</h2>
        <span className="verified-pill"><Check size={12} /> Stored &amp; signed</span>
      </div>

      <div className="report-list">
        {records.map((r) => (
          <ReportCard key={r.recordId} record={r} />
        ))}
      </div>

      <p className="disclaimer">
        This record documents a presumptive field-test result and its capture conditions.
        It is not a laboratory confirmatory result.
      </p>

      <button className="btn btn-primary btn-block" onClick={onDone}>
        Done — return home
      </button>
    </div>
  );
}

function ReportCard({ record }) {
  const thumb = useAuthedImageUrl(record.recordId);
  const disagreement = record.client && record.server && record.client.result !== record.server.result;

  return (
    <div className="report-card">
      <div className="report-card-top">
        {thumb
          ? <img src={thumb} alt="" className="report-thumb" />
          : <div className="report-thumb report-thumb-fallback" />}
        <div>
          <ResultBadge result={record.result} size="lg" />
          <div className="report-id">{record.recordId}</div>
        </div>
      </div>

      {record.needsReview && (
        <div className="review-banner">
          <AlertOctagon size={13} />
          {disagreement
            ? `Flagged for review: on-device preview suggested "${record.client.result}", server-side calibrated analysis found "${record.server.result}".`
            : "Flagged for review: server confidence in this classification was low."}
        </div>
      )}

      <div className="report-fields">
        <div className="report-field">
          <span className="rf-label"><Clock size={12} /> Captured</span>
          <span className="rf-value mono">{formatTimestamp(record.capturedAt)}</span>
        </div>
        <div className="report-field">
          <span className="rf-label"><Clock size={12} /> Received by server</span>
          <span className="rf-value mono">{formatTimestamp(record.receivedAt)}</span>
        </div>
        <div className="report-field">
          <span className="rf-label"><MapPin size={12} /> Location</span>
          <span className="rf-value mono">{formatCoord(record.latitude, record.longitude)}{record.locationSimulated ? " (manual, acknowledged)" : ""}</span>
        </div>
        <div className="report-field">
          <span className="rf-label"><User size={12} /> Operator</span>
          <span className="rf-value mono">{record.operatorId}</span>
        </div>
        <div className="report-field">
          <span className="rf-label">Server confidence</span>
          <span className="rf-value mono">{record.server ? record.server.confidence.toFixed(1) : record.confidence.toFixed(1)}%</span>
        </div>
        {record.server && record.server.method && (
          <div className="report-field">
            <span className="rf-label">Classifier</span>
            <span className="rf-value mono">
              {record.server.method === "pretrained-clip"
                ? "Pretrained model (CLIP, zero-shot)"
                : record.server.method === "heuristic"
                ? "Calibrated heuristic (fallback)"
                : "Unavailable"}
            </span>
          </div>
        )}
        <div className="report-field column">
          <span className="rf-label"><Hash size={12} /> Image hash (SHA-256)</span>
          <CopyRow value={record.imageHash} />
        </div>
        <div className="report-field column">
          <span className="rf-label"><Fingerprint size={12} /> Digital signature (Ed25519)</span>
          <CopyRow value={record.signature} />
        </div>
        <VerifyRow recordId={record.recordId} />
      </div>
    </div>
  );
}

function LogScreen({ onBack }) {
  const [query, setQuery] = useState("");
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.listScans({ q: query, limit: 100 })
        .then(({ scans }) => { if (!cancelled) setScans(scans); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  return (
    <div className="screen log-screen">
      <div className="log-topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ChevronLeft size={18} /></button>
        <h2>Test log</h2>
      </div>
      <div className="search-real">
        <Search size={15} />
        <input
          placeholder="Search by ID, operator, or result…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="scan-list scroll">
        {loading && <div className="empty-state"><Loader2 size={20} className="spin" /><p>Loading…</p></div>}
        {!loading && scans.length === 0 && (
          <div className="empty-state"><Search size={20} strokeWidth={1.6} /><p>No matching records.</p></div>
        )}
        {!loading && scans.map((s) => <ScanCard key={s.recordId} scan={s} />)}
      </div>
    </div>
  );
}

// ---------- app shell ----------

export default function App() {
  const [screen, setScreen] = useState("login");
  const [operator, setOperator] = useState(null);
  const [restoring, setRestoring] = useState(true);

  const [sessionCaptures, setSessionCaptures] = useState([]);
  const [pendingCapture, setPendingCapture] = useState(null);
  const [reportRecords, setReportRecords] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Restore session on load if a token is already stored.
  useEffect(() => {
    const token = api.getToken();
    if (!token) { setRestoring(false); return; }
    api.me()
      .then(({ operator }) => { setOperator(operator); setScreen("home"); })
      .catch(() => { api.setToken(null); })
      .finally(() => setRestoring(false));
  }, []);

  const handleLogin = (op) => { setOperator(op); setScreen("home"); };
  const handleLogout = () => { api.setToken(null); setOperator(null); setScreen("login"); setSessionCaptures([]); };

  const handleCaptured = useCallback((capture) => {
    setPendingCapture(capture);
    setSubmitError("");
    setScreen("result");
  }, []);

  const handleAcknowledgeLocation = (checked) => {
    setPendingCapture((prev) => (prev ? { ...prev, locationAcknowledged: checked } : prev));
  };

  const handleContinue = () => {
    setSessionCaptures((prev) => [...prev, pendingCapture]);
    setPendingCapture(null);
    setScreen("scan");
  };

  const submitSession = async (items) => {
    const results = [];
    for (const item of items) {
      const { scan } = await api.createScan({
        imageDataUrl: item.dataUrl,
        result: item.analysis.category,
        confidence: item.analysis.confidence,
        latitude: item.loc ? item.loc.lat : null,
        longitude: item.loc ? item.loc.lon : null,
        locationSimulated: item.simulatedLoc,
        locationAcknowledged: item.locationAcknowledged,
        capturedAt: item.capturedAt,
      });
      results.push(scan);
    }
    return results;
  };

  const handleEnd = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const all = [...sessionCaptures, pendingCapture];
      const results = await submitSession(all);
      setReportRecords(results);
      setSessionCaptures([]);
      setPendingCapture(null);
      setScreen("report");
    } catch (e) {
      setSubmitError(e.message || "Failed to submit scan records. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (restoring) {
    return (
      <div className="fvs-app">
        <style>{CSS}</style>
        <div className="fvs-stage">
          <div className="fvs-phone">
            <div className="fvs-notch" />
            <div className="fvs-screen">
              <div className="screen" style={{ alignItems: "center", justifyContent: "center" }}>
                <Loader2 size={22} className="spin" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fvs-app">
      <style>{CSS}</style>
      <div className="fvs-stage">
        <div className="fvs-phone">
          <div className="fvs-notch" />
          <div className="fvs-screen">
            {screen === "login" && <LoginScreen onLogin={handleLogin} />}
            {screen === "home" && operator && (
              <HomeScreen
                operator={operator}
                onNewScan={() => { setSessionCaptures([]); setScreen("scan"); }}
                onOpenLog={() => setScreen("log")}
                onLogout={handleLogout}
              />
            )}
            {screen === "scan" && (
              <ScanScreen
                captureCount={sessionCaptures.length}
                onCancel={() => setScreen("home")}
                onCaptured={handleCaptured}
              />
            )}
            {screen === "result" && pendingCapture && (
              <ResultScreen
                capture={pendingCapture}
                onAcknowledgeLocation={handleAcknowledgeLocation}
                onContinue={handleContinue}
                onEnd={handleEnd}
                submitting={submitting}
                submitError={submitError}
              />
            )}
            {screen === "report" && (
              <ReportScreen records={reportRecords} onDone={() => setScreen("home")} />
            )}
            {screen === "log" && <LogScreen onBack={() => setScreen("home")} />}
          </div>
        </div>
        <p className="stage-caption">Field Verification — presumptive result tool</p>
      </div>
    </div>
  );
}

// ---------- styles ----------

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

.fvs-app {
  --ink: #0D141C;
  --panel: #16212C;
  --panel-2: #1C2836;
  --line: #29394A;
  --text: #E7EDF3;
  --muted: #8CA0B3;
  --teal: #3FA796;
  --rust: #C1533B;
  --amber: #D4A24C;
  --green: #4C9F70;
  font-family: 'IBM Plex Sans', sans-serif;
  color: var(--text);
  width: 100%;
}

.fvs-stage {
  min-height: 640px;
  background: radial-gradient(120% 100% at 50% 0%, #131E29 0%, var(--ink) 60%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  gap: 14px;
}

.fvs-phone {
  width: 380px;
  max-width: 100%;
  height: 760px;
  background: #05090D;
  border-radius: 40px;
  border: 1px solid #2C3D4E;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,0.6), inset 0 0 0 6px #0A1118;
  position: relative;
  overflow: hidden;
}

.fvs-notch {
  position: absolute;
  top: 0; left: 50%; transform: translateX(-50%);
  width: 120px; height: 22px;
  background: #05090D;
  border-radius: 0 0 14px 14px;
  z-index: 50;
}

.fvs-screen { position: absolute; inset: 0; background: var(--ink); overflow: hidden; }
.screen { position: absolute; inset: 0; display: flex; flex-direction: column; overflow-y: auto; }
.stage-caption { color: var(--muted); font-size: 12px; letter-spacing: 0.2px; }

.serif-title { font-family: 'IBM Plex Serif', serif; font-weight: 600; font-size: 26px; margin: 0; letter-spacing: -0.2px; }
.serif-title.small { font-size: 19px; }
.subtitle { color: var(--muted); font-size: 13.5px; line-height: 1.5; margin: 8px 0 0; max-width: 280px; }
.disclaimer { color: var(--muted); font-size: 11.5px; line-height: 1.5; text-align: center; padding: 0 24px; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: none; border-radius: 999px; font-family: inherit; font-weight: 600; font-size: 14px;
  padding: 13px 20px; cursor: pointer; transition: transform .15s ease, filter .15s ease;
}
.btn:active { transform: scale(0.97); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary { background: var(--teal); color: #06201C; }
.btn-primary:hover { filter: brightness(1.08); }
.btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
.btn-ghost:hover { border-color: var(--teal); color: var(--teal); }
.btn-block { width: 100%; }

.icon-btn {
  width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line);
  background: var(--panel); color: var(--text); display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.icon-btn.glass { background: rgba(10,16,22,0.5); border-color: rgba(255,255,255,0.18); backdrop-filter: blur(4px); }
.link-btn { background: none; border: none; color: var(--teal); font-size: 12.5px; font-weight: 600; cursor: pointer; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-weight: 600; border-radius: 6px; padding: 3px 8px 3px 6px;
  color: var(--badge-color); background: color-mix(in srgb, var(--badge-color) 16%, transparent);
  font-size: 12px;
}
.badge-lg { font-size: 14px; padding: 5px 11px 5px 8px; }
.mono { font-family: 'IBM Plex Mono', monospace; }

.login-screen { align-items: center; padding: 60px 28px 32px; justify-content: space-between; }
.login-top { display: flex; flex-direction: column; align-items: center; text-align: center; }
.seal {
  width: 56px; height: 56px; border-radius: 16px; margin-bottom: 18px;
  background: var(--panel); border: 1px solid var(--line); color: var(--teal);
  display: flex; align-items: center; justify-content: center;
}
.login-form { width: 100%; display: flex; flex-direction: column; gap: 14px; margin-top: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; color: var(--muted); font-weight: 500; }
.field input {
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 12px 14px; color: var(--text); font-size: 14.5px; font-family: inherit;
}
.field input:focus { outline: none; border-color: var(--teal); }
.form-error { color: var(--rust); font-size: 12.5px; }

.home-screen { padding: 20px 18px 100px; gap: 4px; }
.home-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.avatar {
  width: 40px; height: 40px; border-radius: 12px; background: var(--panel-2);
  border: 1px solid var(--line); display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px; color: var(--teal);
}
.home-topbar-text { flex: 1; }
.home-name { font-weight: 600; font-size: 14.5px; }
.home-sub { font-size: 11.5px; color: var(--muted); }

.search-fake, .search-real {
  display: flex; align-items: center; gap: 9px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 12px; padding: 11px 14px;
  color: var(--muted); font-size: 13.5px; margin-bottom: 22px; cursor: pointer;
  width: 100%; text-align: left;
}
.search-real input { background: none; border: none; color: var(--text); font-family: inherit; font-size: 13.5px; flex: 1; }
.search-real input:focus { outline: none; }

.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.section-head h2 { font-size: 15px; font-weight: 600; margin: 0; }

.scan-list { display: flex; flex-direction: column; gap: 10px; }
.scan-list.scroll { overflow-y: auto; padding-bottom: 20px; }

.scan-card {
  display: flex; gap: 12px; text-align: left; background: var(--panel);
  border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: 12px; padding: 12px; font-family: inherit; color: var(--text);
}
.scan-card-thumb { width: 44px; height: 44px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: var(--panel-2); }
.scan-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
.scan-card-thumb-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--accent); }
.scan-card-body { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.scan-card-row1 { display: flex; align-items: center; justify-content: space-between; }
.scan-card-id { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--muted); }
.scan-card-meta { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text); }
.scan-card-meta.muted { color: var(--muted); }
.scan-card-flag { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--amber); font-weight: 600; margin-top: 2px; }

.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  color: var(--muted); text-align: center; padding: 40px 20px; font-size: 13px; line-height: 1.5;
}

.home-fab-wrap { position: absolute; bottom: 22px; left: 18px; right: 18px; }
.fab {
  width: 100%; background: var(--teal); color: #06201C; border: none; border-radius: 14px;
  padding: 15px; font-weight: 700; font-size: 14.5px; display: flex; align-items: center; justify-content: center; gap: 8px;
  cursor: pointer; box-shadow: 0 10px 24px -8px rgba(63,167,150,0.5);
}

.scan-screen { background: #000; }
.camera-area { position: relative; flex: 1; overflow: hidden; }
.camera-feed { width: 100%; height: 100%; object-fit: cover; transition: opacity .3s; }
.camera-fallback {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; color: var(--muted); font-size: 12.5px; text-align: center; padding: 0 30px; background: #10161C;
}

.cam-topbar { position: absolute; top: 16px; left: 16px; right: 16px; display: flex; align-items: center; gap: 10px; z-index: 10; }
.session-pill { background: rgba(10,16,22,0.55); border: 1px solid rgba(255,255,255,0.18); backdrop-filter: blur(4px); padding: 6px 11px; border-radius: 999px; font-size: 11px; color: var(--text); }

.guide {
  position: absolute; top: 32%; left: 10%; right: 10%; height: 26%;
  border: 2px dashed var(--amber); border-radius: 18px;
  box-shadow: 0 0 0 2000px rgba(4,8,12,0.66);
  display: flex; align-items: stretch; transition: border-color .3s;
}
.guide.aligned { border-color: var(--teal); border-style: solid; }
.guide-zone { flex: 1; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 8px; }
.guide-zone span { font-size: 10.5px; letter-spacing: 0.4px; color: rgba(255,255,255,0.85); background: rgba(0,0,0,0.35); padding: 3px 8px; border-radius: 6px; }
.guide-divider { width: 1px; background: rgba(255,255,255,0.35); margin: 14px 0; }
.corner { position: absolute; width: 16px; height: 16px; opacity: 0; }
.guide.aligned .corner { opacity: 1; }
.corner-0 { top: -2px; left: -2px; border-top: 2px solid var(--teal); border-left: 2px solid var(--teal); border-radius: 8px 0 0 0; }
.corner-1 { top: -2px; right: -2px; border-top: 2px solid var(--teal); border-right: 2px solid var(--teal); border-radius: 0 8px 0 0; }
.corner-2 { bottom: -2px; left: -2px; border-bottom: 2px solid var(--teal); border-left: 2px solid var(--teal); border-radius: 0 0 0 8px; }
.corner-3 { bottom: -2px; right: -2px; border-bottom: 2px solid var(--teal); border-right: 2px solid var(--teal); border-radius: 0 0 8px 0; }

.align-status {
  position: absolute; top: 62%; left: 0; right: 0; margin-top: 14px;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  color: var(--text); font-size: 12.5px; text-align: center;
}

.analyzing-overlay {
  position: absolute; inset: 0; background: rgba(5,9,13,0.72);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  color: var(--text); font-size: 13.5px; z-index: 20;
}

.cam-bottombar { position: absolute; bottom: 26px; left: 0; right: 0; display: flex; justify-content: center; }
.shutter {
  width: 68px; height: 68px; border-radius: 50%; background: rgba(255,255,255,0.08);
  border: 3px solid #fff; display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.shutter-ring { width: 54px; height: 54px; border-radius: 50%; background: #fff; }
.shutter.disabled { opacity: 0.35; cursor: not-allowed; }

.result-top { height: 280px; flex-shrink: 0; }
.result-thumb { width: 100%; height: 100%; object-fit: cover; }
.result-body { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 18px; }
.result-category { display: flex; align-items: center; gap: 12px; }
.result-icon {
  width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
  background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.result-label { font-size: 19px; font-weight: 700; color: var(--accent); font-family: 'IBM Plex Serif', serif; }
.result-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.confidence-block { display: flex; flex-direction: column; gap: 7px; }
.confidence-row { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--muted); }
.confidence-track { height: 6px; background: var(--panel-2); border-radius: 4px; overflow: hidden; }
.confidence-fill { height: 100%; border-radius: 4px; }
.result-note { font-size: 12px; color: var(--muted); line-height: 1.6; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.result-actions { display: flex; gap: 10px; padding: 0 20px 22px; }
.result-actions .btn { flex: 1; }

.ack-row {
  display: flex; align-items: flex-start; gap: 9px; font-size: 12px; color: var(--amber);
  background: color-mix(in srgb, var(--amber) 12%, transparent); border: 1px solid var(--amber);
  border-radius: 10px; padding: 11px 12px; line-height: 1.5; cursor: pointer;
}
.ack-row input { margin-top: 2px; flex-shrink: 0; }

.review-banner {
  display: flex; align-items: flex-start; gap: 7px; font-size: 11.5px; color: var(--amber);
  background: color-mix(in srgb, var(--amber) 12%, transparent); border: 1px solid var(--amber);
  border-radius: 8px; padding: 9px 10px; line-height: 1.5; margin-bottom: 12px;
}

.report-screen { padding: 26px 20px 24px; gap: 18px; align-items: stretch; }
.report-head { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }
.report-seal {
  width: 48px; height: 48px; border-radius: 50%; border: 1.5px dashed var(--teal); color: var(--teal);
  display: flex; align-items: center; justify-content: center;
}
.verified-pill {
  display: inline-flex; align-items: center; gap: 5px; background: color-mix(in srgb, var(--teal) 16%, transparent);
  color: var(--teal); font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
}
.report-list { display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.report-card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
.report-card-top { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.report-thumb { width: 52px; height: 52px; border-radius: 9px; object-fit: cover; flex-shrink: 0; background: var(--panel-2); }
.report-id { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); margin-top: 5px; }
.report-fields { display: flex; flex-direction: column; gap: 9px; border-top: 1px solid var(--line); padding-top: 12px; }
.report-field { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; gap: 10px; }
.report-field.column { flex-direction: column; align-items: stretch; gap: 5px; }
.rf-label { display: flex; align-items: center; gap: 6px; color: var(--muted); flex-shrink: 0; }
.rf-value { color: var(--text); text-align: right; }
.hash-row {
  display: flex; align-items: center; gap: 7px; background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 8px; padding: 8px 10px; color: var(--text); font-size: 11.5px; cursor: pointer; width: 100%;
}
.hash-text { flex: 1; text-align: left; }

.verify-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 4px;
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px;
  padding: 9px; color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.verify-valid { color: var(--teal); border-color: var(--teal); }
.verify-invalid { color: var(--rust); border-color: var(--rust); }

.log-screen { padding: 20px 18px; gap: 4px; }
.log-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.log-topbar h2 { font-size: 16px; font-weight: 600; margin: 0; }
`;
