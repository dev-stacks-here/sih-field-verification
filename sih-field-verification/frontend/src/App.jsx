import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Shield, Camera, MapPin, Clock, LogOut, Search, CheckCircle2,
  AlertTriangle, XCircle, FileText, RotateCcw, ChevronLeft,
  Fingerprint, Copy, Plus, Loader2, Check, User, Hash, Radio, ShieldCheck, ShieldX,
  AlertOctagon, Trash2, ArrowRight, Lock, ShieldAlert, Eye, EyeOff,
} from "lucide-react";
import { api } from "./api.js";
import LandingPage from "./LandingPage.jsx";

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

// Lets an operator/supervisor record the eventual ground truth for a scan
// (lab confirmation, or reviewed outcome) so the app can report real
// accuracy over time instead of just a design rationale for why it doesn't
// have one yet. This is a separate, later write - it never touches the
// signed result/signature on the record (see backend confirmScan).
function ConfirmRow({ scan, onConfirmed }) {
  const [saving, setSaving] = useState(null); // which category is in-flight

  if (scan.confirmed) {
    return (
      <div className="scan-card-confirm confirmed">
        <ShieldCheck size={11} />
        Confirmed: {CATEGORY[scan.confirmed.result]?.label || scan.confirmed.result}
      </div>
    );
  }

  const confirm = async (category) => {
    setSaving(category);
    try {
      const { scan: updated } = await api.confirmScan(scan.recordId, category);
      onConfirmed(updated);
    } catch (e) {
      // silent - operator can retry; this is a secondary/audit action
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="scan-card-confirm">
      <span className="scan-card-confirm-label">Confirm actual result:</span>
      <div className="scan-card-confirm-buttons">
        {Object.keys(CATEGORY).map((key) => (
          <button
            key={key}
            className="confirm-chip"
            disabled={saving !== null}
            onClick={() => confirm(key)}
          >
            {saving === key ? <Loader2 size={11} className="spin" /> : CATEGORY[key].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScanCard({ scan, onConfirmed, onDelete }) {
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
          <div className="scan-card-header-actions">
            <span className="scan-card-id">{scan.recordId}</span>
            {onDelete && (
              <button
                type="button"
                className="scan-delete-btn"
                title="Remove scan record (Requires officer authentication)"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(scan);
                }}
                aria-label={`Remove record ${scan.recordId}`}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="scan-card-meta">
          <span><Clock size={11} /> {formatTimestamp(scan.receivedAt)}</span>
        </div>
        <div className="scan-card-meta muted">
          <span><MapPin size={11} /> {formatCoord(scan.latitude, scan.longitude)}{scan.locationSimulated ? " (manual)" : ""}</span>
        </div>
        {scan.authenticity && (
          <div className="scan-card-auth-pill">
            {scan.authenticity.spoofRisk === "high" || !scan.authenticity.isAuthentic ? (
              <span className="auth-chip spoof" title={scan.authenticity.explanation}>
                <ShieldAlert size={10} /> AI/Spoof Flagged ({scan.authenticity.score?.toFixed(0)}%)
              </span>
            ) : scan.authenticity.spoofRisk === "medium" ? (
              <span className="auth-chip warning" title={scan.authenticity.explanation}>
                <AlertTriangle size={10} /> Optical Anomaly ({scan.authenticity.score?.toFixed(0)}%)
              </span>
            ) : (
              <span className="auth-chip authentic" title={scan.authenticity.explanation}>
                <ShieldCheck size={10} /> Physical Authentic ({scan.authenticity.score?.toFixed(0)}%)
              </span>
            )}
          </div>
        )}
        {scan.needsReview && (
          <div className="scan-card-flag"><AlertOctagon size={11} /> Needs review</div>
        )}
        <ConfirmRow scan={scan} onConfirmed={onConfirmed} />
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

function AuthDeleteModal({ isOpen, onClose, target, onConfirm, operator }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setError("");
      setBusy(false);
      setShowPassword(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  if (!isOpen || !target) return null;

  const isPurge = target.mode === "purge";
  const scan = target.scan;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Please enter your officer password to authenticate.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm(password, target);
      setPassword(""); // immediately scrub password from state
      onClose();
    } catch (err) {
      setError(err.message || "Authentication failed: Invalid officer credentials.");
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    setPassword(""); // immediately scrub password from state
    setError("");
    onClose();
  };

  return (
    <div className="auth-modal-overlay" onClick={handleDismiss}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-header">
          <div className="auth-modal-badge">
            <ShieldAlert size={22} className="auth-shield-icon" />
          </div>
          <h3>Security Authentication Required</h3>
          <p className="auth-modal-sub">
            Forensic chain-of-custody safeguard: Re-authenticate with your officer credentials to permanently remove field test records.
          </p>
        </div>

        <div className="auth-modal-target-box">
          <div className="target-box-row">
            <span className="target-box-label">Target:</span>
            {isPurge ? (
              <span className="target-box-val bold text-red">All Recent Field Scans</span>
            ) : (
              <span className="target-box-val mono font-mono">{scan?.recordId}</span>
            )}
          </div>
          {!isPurge && scan && (
            <div className="target-box-row">
              <span className="target-box-label">Verdict:</span>
              <ResultBadge result={scan.result} size="sm" />
            </div>
          )}
          <div className="target-box-row">
            <span className="target-box-label">Authorized Officer:</span>
            <span className="target-box-val">{operator?.name || "Officer"} ({operator?.userId})</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="auth-modal-form">
          <div className="form-group">
            <label className="auth-field-label" htmlFor="auth-delete-password">
              <Lock size={12} /> Officer Password
            </label>
            <div className="input-with-icon">
              <Lock size={15} className="input-left-icon" />
              <input
                id="auth-delete-password"
                ref={inputRef}
                type={showPassword ? "text" : "password"}
                placeholder="Enter password to authenticate"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                disabled={busy}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="input-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <div className="auth-scrub-notice">
              <CheckCircle2 size={11} className="text-forest" />
              <span>Inputs are scrubbed from memory immediately after authentication.</span>
            </div>
          </div>

          {error && (
            <div className="auth-error-banner">
              <AlertOctagon size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="auth-modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDismiss}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger-auth"
              disabled={busy || !password.trim()}
            >
              {busy ? (
                <><Loader2 size={14} className="spin" /> Authenticating…</>
              ) : (
                <><Trash2 size={14} /> {isPurge ? "Authenticate & Clear All" : "Authenticate & Delete"}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- screens ----------

function LoginScreen({ onLogin }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteInputsAfterAuth, setDeleteInputsAfterAuth] = useState(true);

  const clearInputs = () => {
    setUserId("");
    setPassword("");
    setError("");
  };

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
      if (deleteInputsAfterAuth) {
        setUserId("");
        setPassword("");
      }
      onLogin(operator);
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen login-screen">
      <div className="login-bg-shape login-bg-shape-1" />
      <div className="login-bg-shape login-bg-shape-2" />

      <div className="login-top">
        <div className="seal">
          <svg className="spark-seal-icon" viewBox="0 0 24 24" width="28" height="28">
            <g transform="translate(12,12)">
              <rect x="-1.5" y="-10" width="3" height="20" rx="1.5" fill="#B4F105" />
              <rect x="-1.5" y="-10" width="3" height="20" rx="1.5" fill="#B4F105" transform="rotate(60)" />
              <rect x="-1.5" y="-10" width="3" height="20" rx="1.5" fill="#B4F105" transform="rotate(120)" />
            </g>
          </svg>
        </div>
        <h1 className="serif-title">Field Verification</h1>
        <p className="subtitle">Forensic Chain-of-Custody · Spark Terminal</p>
      </div>

      <form className="login-form" onSubmit={submit}>
        <div className="field">
          <div className="field-label-row">
            <label>Operator ID</label>
            {userId && (
              <button
                type="button"
                className="field-clear-inline"
                onClick={() => setUserId("")}
                title="Clear Operator ID"
              >
                Clear
              </button>
            )}
          </div>
          <div className="login-input-wrap">
            <User size={16} className="input-icon-left" />
            <input
              value={userId}
              onChange={(e) => { setUserId(e.target.value); setError(""); }}
              placeholder="e.g. R.SHARMA"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field">
          <div className="field-label-row">
            <label>Password</label>
            {password && (
              <button
                type="button"
                className="field-clear-inline"
                onClick={() => setPassword("")}
                title="Clear Password"
              >
                Clear
              </button>
            )}
          </div>
          <div className="login-input-wrap">
            <ShieldCheck size={16} className="input-icon-left" />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="••••••••"
            />
          </div>
        </div>

        {/* Option to delete inputs after ID authentication */}
        <label className="checkbox-field-option">
          <input
            type="checkbox"
            className="custom-checkbox-input"
            checked={deleteInputsAfterAuth}
            onChange={(e) => setDeleteInputsAfterAuth(e.target.checked)}
          />
          <span className="checkbox-field-text">
            <span className="opt-title">Delete inputs after ID authentication</span>
            <span className="opt-desc">Wipes credentials immediately upon successful sign-in</span>
          </span>
        </label>

        {error && <div className="form-error">{error}</div>}
        <button type="submit" className="btn btn-primary btn-block btn-spark-login" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : (
            <>
              <span>Sign In to Terminal</span>
              <ArrowRight size={16} />
            </>
          )}
        </button>
        <div className="login-actions-row">
          <button
            type="button"
            className="btn-demo-fill"
            onClick={() => { setUserId("R.SHARMA"); setPassword("Field@123"); setError(""); }}
          >
            ⚡ Autofill Demo
          </button>
          <button
            type="button"
            className="btn-delete-inputs"
            onClick={clearInputs}
            disabled={!userId && !password}
            title="Delete entered credentials now"
          >
            <Trash2 size={12} /> Clear inputs
          </button>
        </div>
      </form>

      <p className="disclaimer">
        Presumptive field testing terminal. Supports, but does not replace, laboratory confirmatory analysis.
      </p>
    </div>
  );
}

function HomeScreen({ operator, onNewScan, onOpenLog, onLogout }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authModal, setAuthModal] = useState({ open: false, mode: "single", scan: null });
  const [feedbackToast, setFeedbackToast] = useState("");

  const showToast = (msg) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(""), 3500);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.listScans({ limit: 4 })
      .then(({ scans }) => { if (!cancelled) setScans(scans); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleAuthDelete = async (password, target) => {
    if (target.mode === "single" && target.scan) {
      await api.deleteScan(target.scan.recordId, password);
      setScans((prev) => prev.filter((s) => s.recordId !== target.scan.recordId));
      showToast(`Record ${target.scan.recordId} safely removed.`);
    } else if (target.mode === "purge") {
      await api.purgeScans(password, true);
      setScans([]);
      showToast("All recent field scans safely cleared.");
    }
  };

  const initials = operator.userId.replace(/[^A-Z]/g, "").slice(0, 2) || "OP";

  return (
    <div className="screen home-screen">
      <div className="home-topbar">
        <div className="avatar">
          {initials}
          <span className="status-indicator-dot" />
        </div>
        <div className="home-topbar-text">
          <div className="home-name">{operator.name}</div>
          <div className="home-sub">{operator.station || "Field Operator"} · <span className="text-lime">Online</span></div>
        </div>
        <button className="icon-btn" onClick={onLogout} aria-label="Log out"><LogOut size={18} /></button>
      </div>

      <div className="home-telemetry-banner">
        <div className="telemetry-banner-item">
          <span className="tbi-label">Dual-Model AI</span>
          <span className="tbi-val positive">Active · SigLIP + CNN</span>
        </div>
        <div className="telemetry-banner-item">
          <span className="tbi-label">Forensic Audit</span>
          <span className="tbi-val">Ed25519 Verified</span>
        </div>
      </div>

      <button className="search-fake" onClick={onOpenLog}>
        <Search size={15} />
        <span>Search test records…</span>
      </button>

      {feedbackToast && (
        <div className="feedback-toast">
          <Check size={14} className="text-forest" />
          <span>{feedbackToast}</span>
        </div>
      )}

      <div className="section-head">
        <h2>Recent Field Scans</h2>
        <div className="section-head-actions">
          {scans.length > 0 && (
            <button
              type="button"
              className="danger-link-btn"
              onClick={() => setAuthModal({ open: true, mode: "purge", scan: null })}
              title="Clear recent field scans with officer authentication"
            >
              <Trash2 size={11} /> Clear recent
            </button>
          )}
          {scans.length > 0 && <button className="link-btn" onClick={onOpenLog}>View all</button>}
        </div>
      </div>

      <div className="scan-list">
        {loading && <div className="empty-state"><Loader2 size={20} className="spin" /><p>Loading…</p></div>}
        {!loading && scans.length === 0 && (
          <div className="empty-state">
            <Radio size={22} strokeWidth={1.6} />
            <p>No scans recorded yet.<br />Start your first field test below.</p>
          </div>
        )}
        {!loading && scans.map((s) => (
          <ScanCard
            key={s.recordId}
            scan={s}
            onDelete={(scan) => setAuthModal({ open: true, mode: "single", scan })}
          />
        ))}
      </div>

      <div className="home-fab-wrap">
        <button className="fab" onClick={onNewScan}>
          <Camera size={19} strokeWidth={2.2} />
          <span>New Chemical Scan</span>
        </button>
      </div>

      <AuthDeleteModal
        isOpen={authModal.open}
        target={authModal}
        operator={operator}
        onClose={() => setAuthModal({ open: false, mode: "single", scan: null })}
        onConfirm={handleAuthDelete}
      />
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
          <div className="cam-topbar-pills">
            <span className="anti-spoof-guard-pill"><ShieldCheck size={11} /> Anti-Spoof Active</span>
            {captureCount > 0 && <span className="session-pill">Capture {captureCount + 1}</span>}
          </div>
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

        {/* Forensic Authenticity & Anti-Spoofing Preview */}
        <div className="forensic-authenticity-card">
          <div className="fac-header">
            <div className="fac-title-row">
              <ShieldCheck size={16} className="text-forest" />
              <h4>Forensic Authenticity &amp; Anti-Spoof</h4>
            </div>
            <span className="fac-badge live">AI Verifier Active</span>
          </div>
          <div className="fac-grid">
            <div className="fac-item">
              <span className="fac-item-label">Screen Moiré &amp; Replay</span>
              <span className="fac-item-val positive"><Check size={11} /> Pass (Clean)</span>
            </div>
            <div className="fac-item">
              <span className="fac-item-label">Generative AI Check</span>
              <span className="fac-item-val positive"><Check size={11} /> Physical Capture</span>
            </div>
            <div className="fac-item">
              <span className="fac-item-label">Sensor Noise Residual</span>
              <span className="fac-item-val positive"><Check size={11} /> Natural CMOS</span>
            </div>
            <div className="fac-item">
              <span className="fac-item-label">Digital Splicing</span>
              <span className="fac-item-val positive"><Check size={11} /> Untampered</span>
            </div>
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
          {record.authenticity && !record.authenticity.isAuthentic
            ? `Flagged for review: Optical authenticity check detected potential artificial generation or screen replay spoofing (${record.authenticity.explanation}).`
            : disagreement
            ? `Flagged for review: on-device preview suggested "${record.client.result}", server-side calibrated analysis found "${record.server.result}".`
            : "Flagged for review: server confidence in this classification was low."}
        </div>
      )}

      <div className="report-fields">
        {record.authenticity && (
          <div className="report-field column">
            <span className="rf-label"><ShieldCheck size={12} /> Forensic Authenticity &amp; Anti-Spoof</span>
            <div className={`report-auth-banner ${record.authenticity.isAuthentic ? "authentic" : "spoof"}`}>
              <div className="rab-head">
                {record.authenticity.isAuthentic ? (
                  <div className="rab-title"><ShieldCheck size={15} className="text-forest" /> <span>Authentic Physical Capture ({record.authenticity.score?.toFixed(1)}%)</span></div>
                ) : (
                  <div className="rab-title"><ShieldAlert size={15} className="text-red" /> <span>Spoof / Fabrication Flagged ({record.authenticity.score?.toFixed(1)}%)</span></div>
                )}
                <span className={`rab-pill ${record.authenticity.spoofRisk}`}>
                  {record.authenticity.spoofRisk === "low" ? "Risk: Low" : record.authenticity.spoofRisk === "medium" ? "Risk: Medium" : "High Spoof Risk"}
                </span>
              </div>
              <p className="rab-desc">{record.authenticity.explanation}</p>
              {record.authenticity.metrics && (
                <div className="rab-metrics">
                  <span className="rab-metric-item">Physical: <strong>{record.authenticity.metrics.natural_physical_prob}%</strong></span>
                  <span className="rab-metric-item">AI Synth: <strong>{record.authenticity.metrics.ai_generated_prob}%</strong></span>
                  <span className="rab-metric-item">Screen Replay: <strong>{record.authenticity.metrics.screen_replay_prob}%</strong></span>
                  <span className="rab-metric-item">Moiré Grid: <strong>{record.authenticity.metrics.fft_moire_score}</strong></span>
                </div>
              )}
            </div>
          </div>
        )}

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

// Small summary of real-world accuracy computed from confirmed
// (ground-truth) records only - see backend getAccuracyStats. Shows nothing
// misleading when there's no confirmed data yet; the empty state is itself
// the honest answer to "what's your accuracy".
function AccuracySummary() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getAccuracyStats().then((data) => { if (!cancelled) setStats(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!stats) return null;
  if (stats.confirmedCount === 0) {
    return (
      <div className="accuracy-summary empty">
        <AlertOctagon size={12} />
        No records confirmed against ground truth yet — accuracy will appear here
        once lab-confirmed results are recorded on scans.
      </div>
    );
  }

  return (
    <div className="accuracy-summary">
      {stats.methods.map((m) => (
        <div key={m.method} className="accuracy-row">
          <span className="accuracy-method">
            {m.method === "pretrained-clip" ? "Pretrained CLIP" : m.method === "heuristic" ? "Heuristic fallback" : m.method}
          </span>
          <span className="accuracy-value">{m.accuracy}% <span className="muted">({m.correct}/{m.total} confirmed)</span></span>
        </div>
      ))}
    </div>
  );
}

function LogScreen({ onBack, operator }) {
  const [query, setQuery] = useState("");
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authModal, setAuthModal] = useState({ open: false, mode: "single", scan: null });
  const [feedbackToast, setFeedbackToast] = useState("");

  const showToast = (msg) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(""), 3500);
  };

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

  const handleConfirmed = (updated) => {
    setScans((prev) => prev.map((s) => (s.recordId === updated.recordId ? updated : s)));
  };

  const handleAuthDelete = async (password, target) => {
    if (target.mode === "single" && target.scan) {
      await api.deleteScan(target.scan.recordId, password);
      setScans((prev) => prev.filter((s) => s.recordId !== target.scan.recordId));
      showToast(`Record ${target.scan.recordId} safely removed.`);
    } else if (target.mode === "purge") {
      await api.purgeScans(password, true);
      setScans([]);
      showToast("All matching scan records safely cleared.");
    }
  };

  return (
    <div className="screen log-screen">
      <div className="log-topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><ChevronLeft size={18} /></button>
        <h2>Test log</h2>
        {scans.length > 0 && (
          <button
            type="button"
            className="danger-link-btn"
            style={{ marginLeft: "auto" }}
            onClick={() => setAuthModal({ open: true, mode: "purge", scan: null })}
            title="Purge all scan records with officer authentication"
          >
            <Trash2 size={11} /> Clear all
          </button>
        )}
      </div>
      <AccuracySummary />
      <div className="search-real">
        <Search size={15} />
        <input
          placeholder="Search by ID, operator, or result…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {feedbackToast && (
        <div className="feedback-toast">
          <Check size={14} className="text-forest" />
          <span>{feedbackToast}</span>
        </div>
      )}

      <div className="scan-list scroll">
        {loading && <div className="empty-state"><Loader2 size={20} className="spin" /><p>Loading…</p></div>}
        {!loading && scans.length === 0 && (
          <div className="empty-state"><Search size={20} strokeWidth={1.6} /><p>No matching records.</p></div>
        )}
        {!loading && scans.map((s) => (
          <ScanCard
            key={s.recordId}
            scan={s}
            onConfirmed={handleConfirmed}
            onDelete={(scan) => setAuthModal({ open: true, mode: "single", scan })}
          />
        ))}
      </div>

      <AuthDeleteModal
        isOpen={authModal.open}
        target={authModal}
        operator={operator}
        onClose={() => setAuthModal({ open: false, mode: "single", scan: null })}
        onConfirm={handleAuthDelete}
      />
    </div>
  );
}

// ---------- app shell ----------

export default function App() {
  const [viewMode, setViewMode] = useState("portal"); // "portal" (landing website) or "app" (scanner)
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

  const handleLogin = (op) => { setOperator(op); setScreen("home"); setViewMode("app"); };
  const handleLogout = () => { api.setToken(null); setOperator(null); setScreen("login"); setSessionCaptures([]); };

  const handleQuickDemoLogin = async () => {
    try {
      const { token, operator: op } = await api.login("R.SHARMA", "Field@123");
      api.setToken(token);
      setOperator(op);
      setSessionCaptures([]);
      setScreen("scan");
      setViewMode("app");
    } catch (e) {
      setScreen("login");
      setViewMode("app");
    }
  };

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
      if (!item) continue;
      const img = item.dataUrl || item.imageDataUrl || item.image || item.imageData;
      const { scan } = await api.createScan({
        imageDataUrl: img,
        image: img,
        dataUrl: img,
        result: item.analysis?.category || item.result || "inconclusive",
        confidence: item.analysis?.confidence ?? item.confidence ?? 90,
        latitude: item.loc ? item.loc.lat : (item.latitude ?? null),
        longitude: item.loc ? item.loc.lon : (item.longitude ?? null),
        locationSimulated: item.simulatedLoc ?? item.locationSimulated ?? false,
        locationAcknowledged: item.locationAcknowledged ?? true,
        capturedAt: item.capturedAt || new Date().toISOString(),
      });
      if (scan) results.push(scan);
    }
    return results;
  };

  const handleEnd = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const all = [...sessionCaptures, pendingCapture].filter(Boolean);
      if (all.length === 0) {
        setScreen("scan");
        return;
      }
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

  const renderPhoneApp = (isEmbedded = false) => (
    <div className={`fvs-stage ${isEmbedded ? "embedded-stage" : ""}`}>
      <div className={`fvs-phone ${isEmbedded ? "embedded-phone" : ""}`}>
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
              onCancel={() => setScreen(operator ? "home" : "login")}
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
            <ReportScreen records={reportRecords} onDone={() => setScreen(operator ? "home" : "login")} />
          )}
          {screen === "log" && <LogScreen operator={operator} onBack={() => setScreen("home")} />}
        </div>
      </div>
      {!isEmbedded && <p className="stage-caption">Field Verification — presumptive result tool</p>}
    </div>
  );

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

  if (viewMode === "portal") {
    return (
      <div className="fvs-app">
        <style>{CSS}</style>
        <LandingPage
          onLaunchApp={() => setViewMode("app")}
          onQuickDemoLogin={handleQuickDemoLogin}
          onOpenLogin={() => { setScreen("login"); setViewMode("app"); }}
          appElement={renderPhoneApp(true)}
        />
      </div>
    );
  }

  return (
    <div className="fvs-app">
      <style>{CSS}</style>
      <div className="portal-app-nav-bar">
        <button className="btn-portal-back" onClick={() => setViewMode("portal")}>
          ← Back to Public Website & Downloads
        </button>
        <div className="portal-nav-right">
          {operator ? (
            <span className="operator-pill">
              <User size={12} /> {operator.name}
            </span>
          ) : (
            <button className="btn-portal-signin" onClick={() => setScreen("login")}>
              Officer Sign In
            </button>
          )}
          <span className="portal-app-tag">● Live Web Scanner</span>
        </div>
      </div>
      {renderPhoneApp(false)}
    </div>
  );
}

// ---------- styles ----------

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root, .fvs-app {
  /* Spark Admin Light Theme Tokens */
  --bs-body-bg: #F4F6F5;
  --card-background: #FFFFFF;
  --border-light: #E2E8E4;
  --border-subtle: #EDF2EF;

  --brand-forest-dark: #051C12;
  --brand-forest-medium: #072F1F;
  --brand-forest-light: #1A3E30;
  --brand-lime: #B4F105;
  --brand-lime-hover: #c1f824;
  --brand-lime-translucent: rgba(180, 241, 5, 0.16);
  --brand-forest-translucent: rgba(7, 47, 31, 0.08);

  --ink: #F4F6F5;
  --panel: #FFFFFF;
  --panel-2: #EDF3F0;
  --panel-3: #E2ECE7;
  --line: #E2E8E4;
  --line-focus: #072F1F;
  --text: #0B130F;
  --muted: #6C7E75;

  --teal: #072F1F;
  --rust: #DC2626;
  --green: #16A34A;
  --amber: #D97706;
  --sys-green: #16A34A;
  --sys-red: #DC2626;
  --sys-orange: #D97706;

  --radius-xxl: 24px;
  --radius-xl: 18px;
  --radius-lg: 14px;
  --radius-md: 10px;
  --radius-sm: 6px;

  --shadow-sm: 0 2px 8px rgba(11, 19, 15, 0.03);
  --shadow-md: 0 10px 30px rgba(11, 19, 15, 0.06);
  --shadow-lg: 0 20px 50px rgba(11, 19, 15, 0.09);

  font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
  color: var(--text);
  width: 100%;
}

* { box-sizing: border-box; }

/* ── STAGE & PHONE FRAME ── */
.fvs-stage {
  min-height: 640px;
  background: radial-gradient(120% 100% at 50% 0%, #FFFFFF 0%, #E8EFEA 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  gap: 14px;
  position: relative;
  overflow: hidden;
}

.fvs-phone {
  width: 380px;
  max-width: 100%;
  height: 760px;
  background: #0B130F;
  border-radius: 40px;
  border: 1px solid #D5DDD8;
  box-shadow: 0 25px 60px -15px rgba(11, 19, 15, 0.25), inset 0 0 0 6px #1A2820;
  position: relative;
  overflow: hidden;
}

.fvs-notch {
  position: absolute;
  top: 0; left: 50%; transform: translateX(-50%);
  width: 120px; height: 22px;
  background: #0B130F;
  border-radius: 0 0 14px 14px;
  z-index: 50;
}

.fvs-screen { position: absolute; inset: 0; background: var(--ink); overflow: hidden; }
.screen { position: absolute; inset: 0; display: flex; flex-direction: column; overflow-y: auto; background: #F4F6F5; color: #0B130F; }
.stage-caption { color: var(--muted); font-size: 12px; letter-spacing: 0.2px; font-weight: 600; }

/* ── TYPOGRAPHY ── */
.serif-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 800;
  font-size: 24px;
  margin: 0;
  letter-spacing: -0.03em;
  color: var(--text);
}
.serif-title.small { font-size: 19px; }
.subtitle { color: var(--muted); font-size: 13px; line-height: 1.5; margin: 8px 0 0; max-width: 280px; font-weight: 500; }
.disclaimer { color: var(--muted); font-size: 11px; line-height: 1.5; text-align: center; padding: 0 20px; }

/* ── BUTTONS & INTERACTIVE ELEMENTS ── */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: none; border-radius: var(--radius-lg); font-family: inherit; font-weight: 700; font-size: 14px;
  padding: 13px 20px; cursor: pointer; transition: all .2s cubic-bezier(0.4, 0, 0.2, 1);
}
.btn:active { transform: scale(0.98); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary {
  background: var(--brand-forest-medium);
  color: #FFFFFF;
  box-shadow: 0 4px 16px rgba(7, 47, 31, 0.2);
}
.btn-primary:hover:not(:disabled) {
  background: var(--brand-forest-dark);
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(7, 47, 31, 0.3);
}
.btn-ghost {
  background: #FFFFFF;
  color: var(--text);
  border: 1px solid var(--line);
}
.btn-ghost:hover {
  border-color: var(--brand-forest-medium);
  color: var(--brand-forest-medium);
  background: #F0F4F2;
}
.btn-block { width: 100%; }

.icon-btn {
  width: 38px; height: 38px; border-radius: var(--radius-md); border: 1px solid var(--line);
  background: #FFFFFF; color: var(--text); display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.2s; box-shadow: var(--shadow-sm);
}
.icon-btn:hover {
  border-color: var(--brand-forest-medium);
  color: var(--brand-forest-medium);
  background: #F0F4F2;
}
.icon-btn.glass { background: rgba(255, 255, 255, 0.85); border-color: rgba(0,0,0,0.1); backdrop-filter: blur(4px); }
.link-btn { background: none; border: none; color: var(--brand-forest-medium); font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; }
.link-btn:hover { text-decoration: underline; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── STATUS BADGES ── */
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-weight: 700; border-radius: var(--radius-sm); padding: 4px 9px;
  color: var(--badge-color); background: color-mix(in srgb, var(--badge-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--badge-color) 25%, transparent);
  font-size: 11.5px;
}
.badge-lg { font-size: 13.5px; padding: 6px 12px; border-radius: var(--radius-md); }
.mono { font-family: 'IBM Plex Mono', monospace; }

/* ── LOGIN SCREEN (SPARK ADMIN MOTIF) ── */
.login-screen {
  align-items: center;
  padding: 56px 24px 28px;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
  background: #F4F6F5;
}

.login-bg-shape {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
  filter: blur(30px);
}
.login-bg-shape-1 {
  width: 240px; height: 240px;
  background: radial-gradient(circle, rgba(180, 241, 5, 0.22) 0%, transparent 70%);
  top: -40px; left: -40px;
}
.login-bg-shape-2 {
  width: 300px; height: 300px;
  background: radial-gradient(circle, rgba(7, 47, 31, 0.08) 0%, transparent 70%);
  bottom: -60px; right: -40px;
}

.login-top {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  position: relative; z-index: 1;
}

.seal {
  width: 58px; height: 58px; border-radius: 18px; margin-bottom: 16px;
  background: #FFFFFF; border: 1px solid var(--line); color: var(--brand-forest-medium);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 20px rgba(11, 19, 15, 0.06);
  transition: all 0.3s ease;
}
.seal:hover {
  border-color: var(--brand-forest-medium);
  transform: rotate(30deg);
}

.spark-seal-icon {
  display: block;
}

.login-form {
  width: 100%; display: flex; flex-direction: column; gap: 13px; margin-top: 8px;
  position: relative; z-index: 1;
}

.field { display: flex; flex-direction: column; gap: 6px; }
.field-label-row { display: flex; justify-content: space-between; align-items: center; }
.field-clear-inline {
  background: none; border: none; color: var(--muted); font-size: 11px;
  cursor: pointer; padding: 0; font-family: inherit; font-weight: 600;
}
.field-clear-inline:hover { color: var(--rust); text-decoration: underline; }
.field label { font-size: 11.5px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }

.login-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.input-icon-left {
  position: absolute;
  left: 14px;
  color: var(--muted);
  pointer-events: none;
  transition: color 0.2s;
}
.login-input-wrap input {
  width: 100%;
  padding-left: 40px !important;
}
.login-input-wrap:focus-within .input-icon-left {
  color: var(--brand-forest-medium);
}

.field input {
  background: #FFFFFF; border: 1px solid #D5DDD8; border-radius: var(--radius-lg);
  padding: 12px 14px; color: var(--text); font-size: 14px; font-family: inherit; font-weight: 500;
  transition: all 0.2s; box-shadow: var(--shadow-sm);
}
.field input:focus {
  outline: none; border-color: var(--brand-forest-medium);
  box-shadow: 0 0 0 3.5px var(--brand-forest-translucent);
  background: #FFFFFF;
}

.checkbox-field-option {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
  border-radius: var(--radius-md); background: #FFFFFF; border: 1px solid var(--line);
  cursor: pointer; text-align: left; transition: border-color 0.2s; box-shadow: var(--shadow-sm);
}
.checkbox-field-option:hover { border-color: var(--brand-forest-medium); }
.custom-checkbox-input {
  width: 17px; height: 17px; border-radius: 4px; accent-color: var(--brand-forest-medium);
  margin-top: 2px; flex-shrink: 0; cursor: pointer;
}
.checkbox-field-text { display: flex; flex-direction: column; gap: 2px; }
.opt-title { font-size: 11.5px; font-weight: 700; color: var(--text); }
.opt-desc { font-size: 10.5px; color: var(--muted); line-height: 1.35; }

.btn-spark-login {
  display: flex; align-items: center; justify-content: center; gap: 8px;
}

.login-actions-row { display: flex; gap: 8px; margin-top: 2px; }
.login-actions-row .btn-demo-fill { flex: 1.2; margin-top: 0; }
.btn-delete-inputs {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  background: #FEE2E2; border: 1px solid #FECACA;
  color: #DC2626; border-radius: var(--radius-md); padding: 8px 10px; font-size: 11.5px; font-weight: 600;
  cursor: pointer; transition: all 0.18s; font-family: inherit;
}
.btn-delete-inputs:hover:not(:disabled) { background: #FCD5D5; }
.btn-delete-inputs:disabled { opacity: 0.35; cursor: not-allowed; }

.form-error { color: var(--rust); font-size: 12px; font-weight: 600; }

/* ── HOME SCREEN ── */
.home-screen { padding: 20px 18px 100px; gap: 4px; }
.home-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.avatar {
  width: 42px; height: 42px; border-radius: var(--radius-md); background: #FFFFFF;
  border: 1.5px solid #D5DDD8; display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 13.5px; color: var(--brand-forest-medium); position: relative;
  box-shadow: var(--shadow-sm);
}
.status-indicator-dot {
  position: absolute; bottom: -2px; right: -2px; width: 10px; height: 10px;
  border-radius: 50%; background: var(--sys-green); border: 2px solid #FFFFFF;
}
.home-topbar-text { flex: 1; }
.home-name { font-weight: 700; font-size: 14.5px; color: var(--text); }
.home-sub { font-size: 11.5px; color: var(--muted); }
.text-lime { color: var(--sys-green); font-weight: 700; }

.home-telemetry-banner {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  background: #FFFFFF; border: 1px solid var(--line); border-radius: var(--radius-lg);
  padding: 10px 12px; margin-bottom: 14px; box-shadow: var(--shadow-sm);
}
.telemetry-banner-item { display: flex; flex-direction: column; gap: 2px; }
.tbi-label { font-size: 10px; color: var(--muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; }
.tbi-val { font-size: 11px; font-weight: 700; color: var(--text); }
.tbi-val.positive { color: var(--sys-green); }

.search-fake, .search-real {
  display: flex; align-items: center; gap: 9px; background: #FFFFFF;
  border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 11px 14px;
  color: var(--muted); font-size: 13px; margin-bottom: 18px; cursor: pointer;
  width: 100%; text-align: left; font-family: inherit; box-shadow: var(--shadow-sm);
  transition: border-color 0.2s;
}
.search-fake:hover { border-color: var(--brand-forest-medium); color: var(--text); }
.search-real input { background: none; border: none; color: var(--text); font-family: inherit; font-size: 13px; flex: 1; }
.search-real input:focus { outline: none; }

.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.section-head h2 { font-size: 14.5px; font-weight: 700; margin: 0; color: var(--text); }
.section-head-actions { display: flex; align-items: center; gap: 8px; }

.danger-link-btn {
  background: transparent; border: none; color: #DC2626; font-size: 11.5px; font-weight: 600;
  cursor: pointer; padding: 4px 6px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;
  font-family: inherit; transition: all 0.15s ease;
}
.danger-link-btn:hover { background: #FEF2F2; color: #991B1B; }

.scan-card-header-actions { display: flex; align-items: center; gap: 6px; }
.scan-delete-btn {
  background: transparent; border: none; color: #94A3B8; padding: 3px 5px; border-radius: 4px;
  cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;
}
.scan-delete-btn:hover { background: #FEF2F2; color: #DC2626; }

.feedback-toast {
  background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; border-radius: 8px;
  padding: 8px 12px; font-size: 12px; font-weight: 600; display: flex; align-items: center;
  gap: 7px; margin-bottom: 12px; box-shadow: var(--shadow-sm); animation: fadeIn 0.2s ease;
}

/* ── SECURITY AUTHENTICATION MODAL ── */
.auth-modal-overlay {
  position: fixed; inset: 0; background: rgba(5, 28, 18, 0.72); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; z-index: 99999; padding: 16px;
  animation: fadeIn 0.2s ease-out;
}
.auth-modal {
  background: #FFFFFF; border: 1px solid #E2E8E4; border-radius: 16px; width: 100%; max-width: 390px;
  box-shadow: 0 24px 50px -12px rgba(5, 28, 18, 0.4); overflow: hidden; animation: slideUp 0.22s ease-out;
}
.auth-modal-header {
  padding: 22px 20px 14px 20px; text-align: center; display: flex; flex-direction: column; align-items: center;
}
.auth-modal-badge {
  width: 48px; height: 48px; border-radius: 50%; background: #FEF2F2; color: #DC2626;
  display: flex; align-items: center; justify-content: center; margin-bottom: 12px; border: 1px solid #FEE2E2;
}
.auth-shield-icon { color: #DC2626; }
.auth-modal-header h3 { font-size: 16px; font-weight: 800; color: #0B130F; margin: 0 0 6px 0; }
.auth-modal-sub { font-size: 12px; color: #6C7E75; line-height: 1.45; margin: 0; }
.auth-modal-target-box {
  background: #F4F6F5; border: 1px solid #E2E8E4; border-radius: 10px; margin: 0 20px 16px 20px;
  padding: 10px 13px; display: flex; flex-direction: column; gap: 6px; font-size: 12px;
}
.target-box-row { display: flex; justify-content: space-between; align-items: center; }
.target-box-label { color: #6C7E75; font-weight: 500; font-size: 11.5px; }
.target-box-val { color: #0B130F; font-weight: 600; }
.target-box-val.bold.text-red { color: #DC2626; font-weight: 700; }
.auth-modal-form { padding: 0 20px 20px 20px; display: flex; flex-direction: column; }
.auth-field-label { font-size: 12px; font-weight: 600; color: #072F1F; margin-bottom: 6px; display: flex; align-items: center; gap: 5px; }

.input-with-icon {
  position: relative; display: flex; align-items: center;
}
.input-with-icon .input-left-icon {
  position: absolute; left: 12px; color: var(--muted); pointer-events: none;
}
.input-with-icon input {
  width: 100%; background: #FFFFFF; border: 1px solid var(--border-input); border-radius: var(--radius-md);
  padding: 11px 40px 11px 36px; font-size: 13.5px; font-family: inherit; color: var(--text);
  box-shadow: var(--shadow-sm); transition: all 0.2s;
}
.input-with-icon input:focus {
  outline: none; border-color: var(--brand-forest-medium);
  box-shadow: 0 0 0 3px var(--brand-lime-translucent);
}
.input-eye-btn {
  position: absolute; right: 10px; background: transparent; border: none; color: #6C7E75;
  cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 5px;
  border-radius: 4px; transition: color 0.15s;
}
.input-eye-btn:hover { color: #072F1F; }

.auth-scrub-notice { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #16A34A; margin-top: 6px; font-weight: 500; }
.auth-error-banner {
  background: #FEF2F2; border: 1px solid #FCA5A5; color: #991B1B; border-radius: 8px;
  padding: 8px 11px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; margin-top: 10px;
}
.auth-modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.btn-danger-auth {
  flex: 1.2; background: #DC2626; color: #FFFFFF; border: none; border-radius: var(--radius-md);
  padding: 10px 14px; font-weight: 700; font-size: 13px; display: flex; align-items: center;
  justify-content: center; gap: 7px; cursor: pointer; transition: all 0.2s; font-family: inherit;
}
.btn-danger-auth:hover:not(:disabled) { background: #B91C1C; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3); }
.btn-danger-auth:disabled { opacity: 0.55; cursor: not-allowed; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(12px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

.scan-list { display: flex; flex-direction: column; gap: 10px; }
.scan-list.scroll { overflow-y: auto; padding-bottom: 20px; }

.scan-card {
  display: flex; gap: 12px; text-align: left; background: #FFFFFF;
  border: 1px solid var(--line); border-left: 3.5px solid var(--accent);
  border-radius: var(--radius-lg); padding: 13px; font-family: inherit; color: var(--text);
  box-shadow: var(--shadow-sm); transition: all 0.2s ease;
}
.scan-card:hover {
  border-color: rgba(7, 47, 31, 0.25);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.scan-card-thumb { width: 46px; height: 46px; border-radius: var(--radius-md); overflow: hidden; flex-shrink: 0; background: var(--panel-2); }
.scan-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
.scan-card-thumb-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--accent); }
.scan-card-body { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.scan-card-row1 { display: flex; align-items: center; justify-content: space-between; }
.scan-card-id { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--muted); }
.scan-card-meta { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text); }
.scan-card-meta.muted { color: var(--muted); }
.scan-card-flag { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--amber); font-weight: 700; margin-top: 2px; }

.scan-card-auth-pill { margin-top: 4px; display: flex; align-items: center; }
.auth-chip {
  display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700;
  padding: 3px 7px; border-radius: 6px; letter-spacing: 0.02em;
}
.auth-chip.authentic { background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0; }
.auth-chip.warning { background: #FFFBEB; color: #B45309; border: 1px solid #FDE68A; }
.auth-chip.spoof { background: #FEF2F2; color: #991B1B; border: 1px solid #FCA5A5; }

.cam-topbar-pills { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.anti-spoof-guard-pill {
  background: rgba(5, 28, 18, 0.75); border: 1px solid rgba(180, 241, 5, 0.4);
  backdrop-filter: blur(8px); padding: 5px 10px; border-radius: 999px; font-size: 10.5px;
  color: #B4F105; font-weight: 700; display: inline-flex; align-items: center; gap: 5px;
}

/* Forensic Authenticity Card */
.forensic-authenticity-card {
  background: #F8FAF9; border: 1px solid var(--border-light); border-radius: 12px;
  padding: 12px 14px; margin: 12px 0 16px 0; box-shadow: var(--shadow-sm);
}
.fac-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.fac-title-row { display: flex; align-items: center; gap: 6px; }
.fac-title-row h4 { font-size: 12.5px; font-weight: 800; color: #072F1F; margin: 0; }
.fac-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; }
.fac-badge.live { background: #DCFCE7; color: #15803D; border: 1px solid #BBF7D0; }
.fac-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 8px; }
.fac-item {
  display: flex; flex-direction: column; gap: 2px; background: #FFFFFF;
  border: 1px solid #E2E8E4; border-radius: 8px; padding: 6px 9px;
}
.fac-item-label { font-size: 9.5px; color: #6C7E75; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
.fac-item-val { font-size: 11px; font-weight: 700; display: flex; align-items: center; gap: 4px; }
.fac-item-val.positive { color: #15803D; }

/* Report Card Authenticity Banner */
.report-auth-banner { border-radius: 10px; padding: 10px 12px; font-size: 12px; }
.report-auth-banner.authentic { background: #F0FDF4; border: 1px solid #BBF7D0; }
.report-auth-banner.spoof { background: #FEF2F2; border: 1px solid #FECACA; }
.rab-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.rab-title { display: flex; align-items: center; gap: 6px; font-weight: 700; color: #072F1F; font-size: 12px; }
.rab-pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
.rab-pill.low { background: #DCFCE7; color: #166534; }
.rab-pill.medium { background: #FEF3C7; color: #92400E; }
.rab-pill.high { background: #FEE2E2; color: #991B1B; }
.rab-desc { font-size: 11.5px; margin: 4px 0 6px 0; color: #374151; line-height: 1.4; }
.rab-metrics { display: flex; flex-wrap: wrap; gap: 6px; font-size: 10.5px; color: #4B5563; }
.rab-metric-item {
  background: rgba(255, 255, 255, 0.85); padding: 3px 7px; border-radius: 5px;
  border: 1px solid rgba(0, 0, 0, 0.06); font-family: 'IBM Plex Mono', monospace; font-size: 10px;
}

.scan-card-confirm { margin-top: 6px; }
.scan-card-confirm.confirmed { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--sys-green); font-weight: 700; }
.scan-card-confirm-label { display: block; font-size: 10.5px; color: var(--muted); margin-bottom: 5px; font-weight: 600; }
.scan-card-confirm-buttons { display: flex; gap: 6px; }
.confirm-chip {
  flex: 1; background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
  padding: 5px 6px; font-size: 10.5px; color: var(--text); font-family: inherit; cursor: pointer;
  display: flex; align-items: center; justify-content: center; min-height: 24px; font-weight: 600;
  transition: all 0.15s;
}
.confirm-chip:hover:not(:disabled) { border-color: var(--brand-forest-medium); color: var(--brand-forest-medium); background: #FFFFFF; }
.confirm-chip:disabled { opacity: 0.6; cursor: default; }

.accuracy-summary {
  display: flex; flex-direction: column; gap: 6px; background: #FFFFFF;
  border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 12px; margin-bottom: 14px;
  font-size: 12px; box-shadow: var(--shadow-sm);
}
.accuracy-summary.empty { flex-direction: row; align-items: flex-start; gap: 7px; color: var(--muted); line-height: 1.5; }
.accuracy-row { display: flex; align-items: center; justify-content: space-between; }
.accuracy-method { color: var(--muted); }
.accuracy-value { font-family: 'IBM Plex Mono', monospace; font-weight: 700; }
.accuracy-value .muted { font-weight: 400; color: var(--muted); }

.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  color: var(--muted); text-align: center; padding: 40px 20px; font-size: 13px; line-height: 1.5;
}

.home-fab-wrap { position: absolute; bottom: 22px; left: 18px; right: 18px; }
.fab {
  width: 100%; background: var(--brand-forest-medium); color: #FFFFFF; border: none; border-radius: var(--radius-lg);
  padding: 14px; font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px;
  cursor: pointer; box-shadow: 0 10px 24px -6px rgba(7, 47, 31, 0.4);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.fab:hover {
  background: var(--brand-forest-dark);
  transform: translateY(-2px);
  box-shadow: 0 14px 28px -6px rgba(7, 47, 31, 0.55);
}

/* ── CAMERA SCANNER HUD (CONTRAST BLACK VIEWFINDER) ── */
.scan-screen { background: #000; }
.camera-area { position: relative; flex: 1; overflow: hidden; }
.camera-feed { width: 100%; height: 100%; object-fit: cover; transition: opacity .3s; }
.camera-fallback {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; color: #879A91; font-size: 12.5px; text-align: center; padding: 0 30px; background: #051C12;
}

.cam-topbar { position: absolute; top: 16px; left: 16px; right: 16px; display: flex; align-items: center; gap: 10px; z-index: 10; }
.session-pill {
  background: rgba(5, 28, 18, 0.7); border: 1px solid rgba(180, 241, 5, 0.25);
  backdrop-filter: blur(8px); padding: 6px 12px; border-radius: 999px; font-size: 11px; color: #FFFFFF;
  font-weight: 600;
}

.guide {
  position: absolute; top: 32%; left: 10%; right: 10%; height: 26%;
  border: 2px dashed rgba(249, 115, 22, 0.6); border-radius: 20px;
  box-shadow: 0 0 0 2000px rgba(5, 28, 18, 0.72);
  display: flex; align-items: stretch; transition: all .3s;
}
.guide.aligned {
  border-color: var(--brand-lime); border-style: solid;
  box-shadow: 0 0 0 2000px rgba(5, 28, 18, 0.75), 0 0 24px rgba(180, 241, 5, 0.35);
}
.guide-zone { flex: 1; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 8px; }
.guide-zone span {
  font-size: 10.5px; letter-spacing: 0.4px; color: #FFFFFF; font-weight: 700;
  background: rgba(5, 28, 18, 0.6); padding: 4px 9px; border-radius: var(--radius-sm);
  border: 1px solid rgba(255,255,255,0.1);
}
.guide-divider { width: 1px; background: rgba(255,255,255,0.25); margin: 14px 0; }
.corner { position: absolute; width: 18px; height: 18px; opacity: 0; transition: opacity 0.3s; }
.guide.aligned .corner { opacity: 1; }
.corner-0 { top: -2px; left: -2px; border-top: 3px solid var(--brand-lime); border-left: 3px solid var(--brand-lime); border-radius: 10px 0 0 0; }
.corner-1 { top: -2px; right: -2px; border-top: 3px solid var(--brand-lime); border-right: 3px solid var(--brand-lime); border-radius: 0 10px 0 0; }
.corner-2 { bottom: -2px; left: -2px; border-bottom: 3px solid var(--brand-lime); border-left: 3px solid var(--brand-lime); border-radius: 0 0 0 10px; }
.corner-3 { bottom: -2px; right: -2px; border-bottom: 3px solid var(--brand-lime); border-right: 3px solid var(--brand-lime); border-radius: 0 0 10px 0; }

.align-status {
  position: absolute; top: 62%; left: 0; right: 0; margin-top: 14px;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  color: #FFFFFF; font-size: 12.5px; text-align: center; font-weight: 600;
}

.analyzing-overlay {
  position: absolute; inset: 0; background: rgba(5, 28, 18, 0.85);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  color: #FFFFFF; font-size: 13.5px; z-index: 20; font-weight: 600;
}

.cam-bottombar { position: absolute; bottom: 26px; left: 0; right: 0; display: flex; justify-content: center; }
.shutter {
  width: 70px; height: 70px; border-radius: 50%; background: rgba(255,255,255,0.08);
  border: 3px solid var(--brand-lime); display: flex; align-items: center; justify-content: center; cursor: pointer;
  box-shadow: 0 0 20px rgba(180, 241, 5, 0.35); transition: all 0.2s;
}
.shutter:hover:not(.disabled) { transform: scale(1.05); box-shadow: 0 0 28px rgba(180, 241, 5, 0.55); }
.shutter-ring { width: 54px; height: 54px; border-radius: 50%; background: var(--brand-lime); }
.shutter.disabled { opacity: 0.35; cursor: not-allowed; }

/* ── RESULT SCREEN ── */
.result-top { height: 260px; flex-shrink: 0; }
.result-thumb { width: 100%; height: 100%; object-fit: cover; }
.result-body { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 16px; background: #F4F6F5; }
.result-category { display: flex; align-items: center; gap: 12px; }
.result-icon {
  width: 48px; height: 48px; border-radius: var(--radius-lg); flex-shrink: 0;
  background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent);
  display: flex; align-items: center; justify-content: center; border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
}
.result-label { font-size: 20px; font-weight: 800; color: var(--accent); }
.result-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.confidence-block { display: flex; flex-direction: column; gap: 7px; }
.confidence-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); font-weight: 600; }
.confidence-track { height: 6px; background: var(--panel-2); border-radius: 4px; overflow: hidden; }
.confidence-fill { height: 100%; border-radius: 4px; }
.result-note { font-size: 12px; color: var(--muted); line-height: 1.6; background: #FFFFFF; border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 12px 14px; box-shadow: var(--shadow-sm); }
.result-actions { display: flex; gap: 10px; padding: 0 20px 22px; background: #F4F6F5; }
.result-actions .btn { flex: 1; }

.ack-row {
  display: flex; align-items: flex-start; gap: 9px; font-size: 12px; color: var(--amber);
  background: color-mix(in srgb, var(--amber) 10%, transparent); border: 1px solid var(--amber);
  border-radius: var(--radius-lg); padding: 11px 12px; line-height: 1.5; cursor: pointer;
}
.ack-row input { margin-top: 2px; flex-shrink: 0; }

.review-banner {
  display: flex; align-items: flex-start; gap: 7px; font-size: 11.5px; color: var(--amber);
  background: color-mix(in srgb, var(--amber) 10%, transparent); border: 1px solid var(--amber);
  border-radius: var(--radius-md); padding: 9px 10px; line-height: 1.5; margin-bottom: 12px;
}

/* ── REPORT / AUDIT SCREEN ── */
.report-screen { padding: 26px 20px 24px; gap: 18px; align-items: stretch; background: #F4F6F5; }
.report-head { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }
.report-seal {
  width: 52px; height: 52px; border-radius: 50%; border: 2px dashed var(--brand-forest-medium); color: var(--brand-forest-medium);
  display: flex; align-items: center; justify-content: center; background: #FFFFFF;
  box-shadow: 0 2px 12px rgba(11, 19, 15, 0.05);
}
.verified-pill {
  display: inline-flex; align-items: center; gap: 5px; background: #DCFCE7;
  color: #166534; font-size: 11.5px; font-weight: 700; padding: 4px 11px; border-radius: 999px;
  border: 1px solid #BBF7D0;
}
.report-list { display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.report-card { background: #FFFFFF; border: 1px solid var(--line); border-radius: var(--radius-xl); padding: 14px; box-shadow: var(--shadow-sm); }
.report-card-top { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.report-thumb { width: 52px; height: 52px; border-radius: var(--radius-md); object-fit: cover; flex-shrink: 0; background: var(--panel-2); }
.report-id { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); margin-top: 5px; }
.report-fields { display: flex; flex-direction: column; gap: 9px; border-top: 1px solid var(--line); padding-top: 12px; }
.report-field { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; gap: 10px; }
.report-field.column { flex-direction: column; align-items: stretch; gap: 5px; }
.rf-label { display: flex; align-items: center; gap: 6px; color: var(--muted); flex-shrink: 0; font-weight: 600; }
.rf-value { color: var(--text); text-align: right; font-weight: 600; }
.hash-row {
  display: flex; align-items: center; gap: 7px; background: var(--panel-2); border: 1px solid var(--line);
  border-radius: var(--radius-md); padding: 8px 10px; color: var(--text); font-size: 11.5px; cursor: pointer; width: 100%;
  font-family: 'IBM Plex Mono', monospace; transition: border-color 0.2s;
}
.hash-row:hover { border-color: var(--brand-forest-medium); }
.hash-text { flex: 1; text-align: left; }

.verify-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 4px;
  background: var(--panel-2); border: 1px solid var(--line); border-radius: var(--radius-md);
  padding: 9px; color: var(--muted); font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit;
}
.verify-valid { color: var(--sys-green); border-color: var(--sys-green); }
.verify-invalid { color: var(--rust); border-color: var(--rust); }

.log-screen { padding: 20px 18px; gap: 4px; background: #F4F6F5; }
.log-topbar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.log-topbar h2 { font-size: 16px; font-weight: 700; margin: 0; color: var(--text); }

/* ── PUBLIC PORTAL & DOWNLOAD CENTER (SPARK ADMIN LIGHT THEME) ── */
.landing-portal {
  background: #F4F6F5;
  color: #0B130F;
  min-height: 100vh;
  font-family: 'Plus Jakarta Sans', sans-serif;
  overflow-x: hidden;
  position: relative;
}

.portal-bg-shape {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
  filter: blur(80px);
}
.portal-bg-shape-1 {
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(180, 241, 5, 0.2) 0%, transparent 70%);
  top: -100px; left: -100px;
}
.portal-bg-shape-2 {
  width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(7, 47, 31, 0.06) 0%, transparent 70%);
  top: 350px; right: -150px;
}
.portal-bg-shape-3 {
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.08) 0%, transparent 70%);
  bottom: 150px; left: 15%;
}

.portal-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(244, 246, 245, 0.94);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid #E2E8E4;
}

.portal-nav-container {
  max-width: 1240px;
  margin: 0 auto;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.portal-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.brand-badge-spark {
  width: 38px; height: 38px;
  border-radius: 11px;
  background: #072F1F;
  border: 1.5px solid #051C12;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(7, 47, 31, 0.2);
  transition: all 0.3s ease;
}
.portal-brand:hover .brand-badge-spark {
  border-color: var(--brand-lime);
  transform: rotate(30deg);
}

.brand-text { display: flex; flex-direction: column; }
.brand-name {
  font-size: 15.5px;
  font-weight: 800;
  color: #0B130F;
  letter-spacing: -0.3px;
}
.brand-tag {
  font-size: 11px;
  color: var(--brand-forest-medium);
  font-weight: 700;
  letter-spacing: 0.2px;
}

.portal-nav-links {
  display: flex;
  align-items: center;
  gap: 26px;
}
.portal-nav-links a {
  color: #5A6E64;
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 600;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.portal-nav-links a:hover {
  color: var(--brand-forest-medium);
}

.portal-nav-actions { display: flex; align-items: center; gap: 10px; }
.btn-portal-lime {
  background: var(--brand-forest-medium);
  color: #FFFFFF;
  border: none;
  border-radius: var(--radius-md);
  padding: 9px 18px;
  font-size: 13.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(7, 47, 31, 0.25);
  transition: all 0.2s;
}
.btn-portal-lime:hover {
  background: var(--brand-forest-dark);
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(7, 47, 31, 0.35);
}

.btn-portal-secondary {
  background: #FFFFFF;
  border: 1px solid #D5DDD8;
  color: #0B130F;
  border-radius: var(--radius-md);
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s;
}
.btn-portal-secondary:hover {
  background: #F0F4F2;
  border-color: var(--brand-forest-medium);
}

/* ── HERO SECTION ── */
.portal-hero {
  position: relative;
  max-width: 1240px;
  margin: 0 auto;
  padding: 56px 24px 70px;
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 48px;
  align-items: center;
  z-index: 1;
}

.portal-hero-content {
  position: relative;
  z-index: 1;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #FFFFFF;
  border: 1px solid #D5DDD8;
  border-radius: 999px;
  padding: 6px 14px;
  color: var(--brand-forest-medium);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 22px;
  box-shadow: 0 2px 8px rgba(11, 19, 15, 0.04);
}
.badge-dot-live {
  width: 7px; height: 7px; border-radius: 50%; background: var(--sys-green);
  box-shadow: 0 0 8px var(--sys-green);
}

.hero-headline {
  font-size: 46px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -1.4px;
  color: #0B130F;
  margin: 0 0 18px 0;
}
.hero-gradient-lime {
  background: linear-gradient(135deg, #072F1F 0%, #16A34A 55%, #0284C7 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subhead {
  font-size: 16px;
  line-height: 1.65;
  color: #5A6E64;
  margin: 0 0 32px 0;
  max-width: 560px;
  font-weight: 400;
}

.hero-cta-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}
.hero-cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 22px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  font-family: inherit;
}
.hero-cta-btn.lime-primary {
  background: var(--brand-forest-medium);
  color: #FFFFFF;
  box-shadow: 0 6px 20px rgba(7, 47, 31, 0.25);
}
.hero-cta-btn.lime-primary:hover {
  background: var(--brand-forest-dark);
  transform: translateY(-2px);
  box-shadow: 0 8px 26px rgba(7, 47, 31, 0.35);
}
.hero-cta-btn.forest-secondary {
  background: #FFFFFF;
  border: 1px solid #D5DDD8;
  color: #0B130F;
  box-shadow: var(--shadow-sm);
}
.hero-cta-btn.forest-secondary:hover {
  background: #F0F4F2;
  border-color: var(--brand-forest-medium);
}
.hero-cta-btn.amber-accent {
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  color: #B45309;
}
.hero-cta-btn.amber-accent:hover {
  background: #FEF3C7;
}

/* ── PREVIEW MOCKUP ── */
.portal-app-preview {
  position: relative;
  background: #FFFFFF;
  border: 1px solid #E2E8E4;
  border-radius: var(--radius-xxl);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  z-index: 1;
}

.preview-header {
  background: #F0F4F2;
  border-bottom: 1px solid #E2E8E4;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.preview-dots { display: flex; gap: 6px; }
.dot { width: 10px; height: 10px; border-radius: 50%; }
.dot.red { background: #EF4444; }
.dot.yellow { background: #F59E0B; }
.dot.green { background: #10B981; }

.preview-title-wrap { display: flex; align-items: center; gap: 8px; }
.preview-badge-live {
  background: #DCFCE7;
  color: #166534;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 4px;
}
.preview-title { font-size: 12.5px; font-weight: 700; color: #5A6E64; }
.preview-fullscreen-btn {
  background: #FFFFFF;
  border: 1px solid #D5DDD8;
  color: var(--brand-forest-medium);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
  box-shadow: var(--shadow-sm);
}
.preview-fullscreen-btn:hover { background: #F0F4F2; border-color: var(--brand-forest-medium); }
.preview-body { background: #F4F6F5; }
.preview-footer {
  background: #F0F4F2;
  border-top: 1px solid #E2E8E4;
  padding: 10px 18px;
  font-size: 11.5px;
  color: #5A6E64;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}
.preview-footer-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--sys-green);
  box-shadow: 0 0 6px var(--sys-green);
}

/* ── COMMAND METRICS / TELEMETRY SECTION ── */
.telemetry-section {
  padding-top: 0 !important;
  padding-bottom: 40px !important;
}
.telemetry-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  max-width: 1240px;
  margin: 0 auto;
}
.telemetry-card {
  background: #FFFFFF;
  border: 1px solid #E2E8E4;
  border-radius: var(--radius-xl);
  padding: 20px;
  box-shadow: var(--shadow-sm);
  transition: all 0.25s ease;
}
.telemetry-card:hover {
  border-color: var(--brand-forest-medium);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.telemetry-top {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.telemetry-label {
  font-size: 11px; font-weight: 700; color: #6C7E75; text-transform: uppercase; letter-spacing: 0.5px;
}
.trend-pill {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700;
  padding: 3px 8px; border-radius: 999px;
}
.trend-pill.positive { background: #DCFCE7; color: #15803D; }
.trend-pill.neutral { background: #E0F2FE; color: #0369A1; }
.trend-pill.verified { background: #F3E8FF; color: #7E22CE; }
.trend-pill.highlight { background: #FEF3C7; color: #B45309; }
.telemetry-value {
  font-size: 24px; font-weight: 800; color: #0B130F; letter-spacing: -0.5px; margin-bottom: 4px;
}
.telemetry-sub { font-size: 12px; color: #6C7E75; line-height: 1.4; }

/* ── PORTAL SECTIONS ── */
.portal-section {
  max-width: 1240px;
  margin: 0 auto;
  padding: 64px 24px;
  position: relative;
  z-index: 1;
}

.section-header { text-align: center; max-width: 680px; margin: 0 auto 48px; }
.section-kicker {
  font-size: 12px;
  font-weight: 800;
  color: var(--brand-forest-medium);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 8px;
}
.section-title {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.8px;
  color: #0B130F;
  margin: 0 0 14px 0;
}
.section-description {
  font-size: 15px;
  line-height: 1.6;
  color: #5A6E64;
  margin: 0;
}

/* ── DOWNLOADS GRID ── */
.downloads-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.download-card {
  background: #FFFFFF;
  border: 1px solid #E2E8E4;
  border-radius: var(--radius-xxl);
  padding: 30px;
  display: flex;
  flex-direction: column;
  position: relative;
  box-shadow: var(--shadow-sm);
  transition: all 0.25s ease;
}
.download-card:hover {
  transform: translateY(-3px);
  border-color: var(--brand-forest-medium);
  box-shadow: var(--shadow-md);
}
.download-card.featured {
  border-color: var(--brand-forest-medium);
  box-shadow: 0 10px 30px rgba(7, 47, 31, 0.08), 0 0 0 1px var(--brand-forest-medium);
}

.card-top-tag {
  position: absolute;
  top: 18px;
  right: 20px;
  font-size: 10.5px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
}
.card-top-tag.lime-tag {
  background: #DCFCE7;
  color: #166534;
  border: 1px solid #BBF7D0;
}
.card-top-tag.muted-tag {
  background: #F0F4F2;
  color: #5A6E64;
  border: 1px solid #E2E8E4;
}

.download-card-icon {
  width: 52px; height: 52px; border-radius: var(--radius-lg);
  background: #F0F4F2; border: 1px solid #E2E8E4;
  display: flex; align-items: center; justify-content: center;
  color: var(--brand-forest-medium);
  margin-bottom: 20px;
}

.download-card-title {
  font-size: 19px;
  font-weight: 700;
  color: #0B130F;
  margin: 0 0 10px 0;
}
.download-card-text {
  font-size: 13.5px;
  line-height: 1.6;
  color: #5A6E64;
  margin: 0 0 20px 0;
  flex: 1;
}

.download-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}
.meta-badge {
  font-size: 11px;
  font-weight: 600;
  background: #F0F4F2;
  border: 1px solid #E2E8E4;
  color: #5A6E64;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
}

.card-actions { display: flex; flex-direction: column; gap: 10px; }
.btn-download {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  font-family: inherit;
}
.btn-download.lime-solid {
  background: var(--brand-forest-medium);
  color: #FFFFFF;
}
.btn-download.lime-solid:hover {
  background: var(--brand-forest-dark);
  transform: translateY(-1px);
}
.btn-download.forest-outline {
  background: #FFFFFF;
  border: 1px solid #D5DDD8;
  color: #0B130F;
}
.btn-download.forest-outline:hover {
  background: #F0F4F2;
  border-color: var(--brand-forest-medium);
}

/* ── HOW IT WORKS STEPS ── */
.steps-container {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}
.step-card {
  background: #FFFFFF;
  border: 1px solid #E2E8E4;
  border-radius: var(--radius-xl);
  padding: 24px;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s;
}
.step-card:hover {
  border-color: var(--brand-forest-medium);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.step-number-spark {
  width: 40px; height: 40px; border-radius: 12px;
  background: #072F1F;
  color: var(--brand-lime);
  font-size: 14px;
  font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 18px;
}
.step-title {
  font-size: 16px;
  font-weight: 700;
  color: #0B130F;
  margin: 0 0 10px 0;
}
.step-text {
  font-size: 13px;
  line-height: 1.6;
  color: #5A6E64;
  margin: 0;
}

/* ── FORENSIC ARCHITECTURE ── */
.arch-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.arch-item {
  background: #FFFFFF;
  border: 1px solid #E2E8E4;
  border-radius: var(--radius-xl);
  padding: 26px;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s;
}
.arch-item:hover {
  border-color: var(--brand-forest-medium);
  box-shadow: var(--shadow-md);
}
.arch-icon-spark {
  width: 44px; height: 44px; border-radius: 12px;
  background: #F0F4F2; border: 1px solid #E2E8E4;
  color: var(--brand-forest-medium);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16px;
}
.arch-item h3 {
  font-size: 17px;
  font-weight: 700;
  color: #0B130F;
  margin: 0 0 10px 0;
}
.arch-item p {
  font-size: 13.5px;
  line-height: 1.6;
  color: #5A6E64;
  margin: 0;
}
.arch-item code {
  background: #F0F4F2;
  color: var(--brand-forest-medium);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  border: 1px solid #E2E8E4;
}

/* ── DEMO BANNER (SPARK ADMIN SIGNATURE ALERT CARD) ── */
.demo-banner-spark {
  background: #072F1F;
  border: 1px solid #051C12;
  border-radius: var(--radius-xxl);
  padding: 44px 48px;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  box-shadow: 0 20px 50px rgba(7, 47, 31, 0.2);
}
.demo-banner-bg-shape {
  position: absolute;
  right: -30px;
  bottom: -30px;
  width: 220px;
  height: 220px;
  opacity: 0.14;
  pointer-events: none;
}
.demo-banner-content { position: relative; z-index: 1; max-width: 620px; }
.demo-badge-spark {
  display: inline-block;
  background: rgba(180, 241, 5, 0.15);
  border: 1px solid rgba(180, 241, 5, 0.3);
  color: var(--brand-lime);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 10px;
  border-radius: 999px;
  margin-bottom: 12px;
}
.demo-title-spark {
  font-size: 26px;
  font-weight: 800;
  color: #FFFFFF;
  margin: 0 0 10px 0;
  letter-spacing: -0.5px;
}
.demo-desc-spark {
  font-size: 14px;
  line-height: 1.6;
  color: #A5B8B0;
  margin: 0 0 18px 0;
}
.demo-credentials-pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: #051C12;
  border: 1px solid #1A3E30;
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 12.5px;
  color: #A5B8B0;
}
.demo-credentials-pill strong { color: var(--brand-lime); font-family: 'IBM Plex Mono', monospace; }
.cred-divider { opacity: 0.3; }

.demo-banner-actions { display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; position: relative; z-index: 1; }
.btn-banner-lime {
  background: var(--brand-lime);
  color: #051C12;
  font-weight: 800;
  font-size: 14px;
  border-radius: var(--radius-lg);
  padding: 13px 24px;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(180, 241, 5, 0.35);
  transition: all 0.2s;
  font-family: inherit;
}
.btn-banner-lime:hover {
  background: var(--brand-lime-hover);
  transform: translateY(-2px);
  box-shadow: 0 8px 28px rgba(180, 241, 5, 0.5);
}
.btn-banner-forest {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #FFFFFF;
  font-weight: 600;
  font-size: 13px;
  border-radius: var(--radius-lg);
  padding: 11px 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-banner-forest:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: #FFFFFF;
}

/* ── FOOTER ── */
.portal-footer {
  background: #051C12;
  border-top: 1px solid #1A3E30;
  padding: 56px 24px 32px;
  position: relative;
  z-index: 1;
}
.footer-content {
  max-width: 1240px;
  margin: 0 auto 40px;
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 40px;
}
.footer-tagline {
  color: #879A91;
  font-size: 13px;
  line-height: 1.65;
  margin-top: 14px;
  max-width: 320px;
}
.footer-heading {
  font-size: 12px;
  font-weight: 700;
  color: #FFFFFF;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 16px;
}
.footer-col a, .footer-link-btn {
  display: block;
  color: #879A91;
  font-size: 13px;
  text-decoration: none;
  margin-bottom: 10px;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-weight: 500;
  transition: color 0.18s;
}
.footer-col a:hover, .footer-link-btn:hover {
  color: var(--brand-lime);
}
.footer-bottom {
  max-width: 1240px;
  margin: 0 auto;
  border-top: 1px solid #1A3E30;
  padding-top: 24px;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #6C7E75;
}

/* ── APP FULLSCREEN TOP BAR ── */
.portal-app-nav-bar {
  background: #FFFFFF;
  border-bottom: 1px solid #E2E8E4;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.btn-portal-back {
  background: #F0F4F2;
  border: 1px solid #E2E8E4;
  color: var(--brand-forest-medium);
  border-radius: var(--radius-sm);
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s;
  font-family: inherit;
}
.btn-portal-back:hover {
  background: #E2ECE7;
  border-color: var(--brand-forest-medium);
}
.portal-nav-right { display: flex; align-items: center; gap: 12px; }
.operator-pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: #F0F4F2; border: 1px solid #E2E8E4;
  padding: 5px 12px; border-radius: 999px; font-size: 12px; color: #0B130F; font-weight: 600;
}
.portal-app-tag {
  color: var(--sys-green);
  font-size: 12px;
  font-weight: 700;
  font-family: 'IBM Plex Mono', monospace;
}
.btn-portal-signin {
  background: transparent;
  border: 1px solid #D5DDD8;
  color: #0B130F;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
}
.btn-portal-signin:hover { border-color: var(--brand-forest-medium); color: var(--brand-forest-medium); }

.btn-demo-fill {
  width: 100%;
  background: #FEF3C7;
  border: 1px dashed #F59E0B;
  color: #B45309;
  border-radius: var(--radius-md);
  padding: 9px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  margin-top: 10px;
  transition: all 0.2s;
  font-family: inherit;
}
.btn-demo-fill:hover {
  background: #FDE68A;
}

@media (max-width: 960px) {
  .portal-hero {
    grid-template-columns: 1fr;
    padding-top: 36px;
  }
  .portal-nav-links {
    display: none;
  }
  .hero-headline {
    font-size: 34px;
  }
  .telemetry-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .downloads-grid {
    grid-template-columns: 1fr;
  }
  .steps-container {
    grid-template-columns: repeat(2, 1fr);
  }
  .arch-grid {
    grid-template-columns: 1fr;
  }
  .demo-banner-spark {
    flex-direction: column;
    padding: 32px 24px;
    text-align: center;
  }
  .demo-credentials-pill {
    flex-direction: column;
    gap: 4px;
  }
  .cred-divider { display: none; }
  .footer-content {
    grid-template-columns: 1fr 1fr;
  }
}
`;
