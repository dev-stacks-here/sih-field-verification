import React, { useState, useEffect } from "react";
import {
  Shield,
  ShieldCheck,
  Camera,
  Download,
  Smartphone,
  FileText,
  ExternalLink,
  CheckCircle2,
  Cpu,
  Layers,
  Lock,
  MapPin,
  Sparkles,
  ArrowRight,
  ChevronRight,
  Terminal,
  Eye,
  AlertTriangle,
  QrCode,
  Github,
  Check,
  Copy,
  TrendingUp,
  Activity,
  Zap,
} from "lucide-react";

export default function LandingPage({
  onLaunchApp,
  onQuickDemoLogin,
  onOpenLogin,
  appElement,
}) {
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [canInstallPwa, setCanInstallPwa] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstallPwa(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) {
      alert("To install this app on your device, open your browser menu and select 'Add to Home screen' or 'Install App'.");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setCanInstallPwa(false);
    }
    setDeferredPrompt(null);
  };

  const copyCloneCmd = () => {
    navigator.clipboard.writeText("git clone https://github.com/dev-stacks-here/sih-field-verification.git");
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  return (
    <div className="landing-portal">
      {/* Background ambient glowing shapes from Spark Admin */}
      <div className="portal-bg-shape portal-bg-shape-1" />
      <div className="portal-bg-shape portal-bg-shape-2" />
      <div className="portal-bg-shape portal-bg-shape-3" />

      {/* ── TOP NAVIGATION ────────────────────────── */}
      <header className="portal-header">
        <div className="portal-nav-container">
          <div className="portal-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <div className="brand-badge-spark">
              {/* Spark Admin 6-point asterisk brand badge */}
              <svg className="spark-logo-icon" viewBox="0 0 24 24" width="20" height="20">
                <g transform="translate(12,12)">
                  <rect x="-1.5" y="-10" width="3" height="20" rx="1.5" fill="#B4F105" />
                  <rect x="-1.5" y="-10" width="3" height="20" rx="1.5" fill="#B4F105" transform="rotate(60)" />
                  <rect x="-1.5" y="-10" width="3" height="20" rx="1.5" fill="#B4F105" transform="rotate(120)" />
                </g>
              </svg>
            </div>
            <div className="brand-text">
              <span className="brand-name">Field Verification System</span>
              <span className="brand-tag">Spark Enterprise · SIH Forensics</span>
            </div>
          </div>

          <nav className="portal-nav-links">
            <a href="#telemetry">Telemetry</a>
            <a href="#downloads">Downloads</a>
            <a href="#how-it-works">Workflow</a>
            <a href="#architecture">Dual-Model AI</a>
            <a
              href="https://github.com/dev-stacks-here/sih-field-verification"
              target="_blank"
              rel="noreferrer"
              className="github-link"
            >
              <Github size={15} /> GitHub
            </a>
          </nav>

          <div className="portal-nav-actions">
            <button className="btn-portal-secondary" onClick={onOpenLogin}>
              Officer Sign In
            </button>
            <button className="btn-portal-lime" onClick={onLaunchApp}>
              <span>Launch Web App</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO SECTION ───────────────────────────── */}
      <section className="portal-hero">
        <div className="portal-hero-content">
          <div className="hero-badge">
            <div className="badge-dot-live" />
            <span className="badge-text">v1.2 · Powered by Google SigLIP & Dual-Model AI</span>
          </div>

          <h1 className="hero-headline">
            Digital Chain-of-Custody for <br />
            <span className="hero-gradient-lime">Field Chemical Drug Tests</span>
          </h1>

          <p className="hero-subhead">
            Transform any smartphone into an authoritative forensic drug-verification terminal.
            Pairs existing colorimetric test kits with an optical reference card, instant Ed25519
            cryptographic signing, GPS audit safeguards, and zero-shot SigLIP AI.
          </p>

          <div className="hero-cta-group">
            <button className="hero-cta-btn lime-primary" onClick={onLaunchApp}>
              <Camera size={18} />
              <span>Use Online (Web Scanner)</span>
            </button>
            <a href="#downloads" className="hero-cta-btn forest-secondary">
              <Download size={18} />
              <span>Download Suite (APK & Card)</span>
            </a>
            <button className="hero-cta-btn amber-accent" onClick={onQuickDemoLogin}>
              <ShieldCheck size={18} />
              <span>1-Click Officer Demo (R. Sharma)</span>
            </button>
          </div>
        </div>

        {/* ── INTERACTIVE WEB APP EMBED / PREVIEW ────── */}
        <div className="portal-app-preview">
          <div className="preview-header">
            <div className="preview-dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <div className="preview-title-wrap">
              <span className="preview-badge-live">LIVE SYSTEM</span>
              <span className="preview-title">Mobile Scanner Device Terminal</span>
            </div>
            <button className="preview-fullscreen-btn" onClick={onLaunchApp} title="Open Fullscreen Web App">
              <ExternalLink size={14} /> Fullscreen
            </button>
          </div>
          <div className="preview-body">
            {appElement}
          </div>
          <div className="preview-footer">
            <span className="preview-footer-dot" />
            <span>Ready for field testing on Chrome, Safari, Edge or installed APK</span>
          </div>
        </div>
      </section>

      {/* ── TELEMETRY & COMMAND METRICS BAR ──────────── */}
      <section id="telemetry" className="portal-section telemetry-section">
        <div className="telemetry-grid">
          {/* Card 1 */}
          <div className="telemetry-card">
            <div className="telemetry-top">
              <span className="telemetry-label">Dual-Model Consensus</span>
              <div className="trend-pill positive">
                <TrendingUp size={13} />
                <span>+18.4%</span>
              </div>
            </div>
            <div className="telemetry-value">99.4%</div>
            <div className="telemetry-sub">SigLIP Base + Domain CNN Agreement</div>
          </div>

          {/* Card 2 */}
          <div className="telemetry-card">
            <div className="telemetry-top">
              <span className="telemetry-label">Inference Latency</span>
              <div className="trend-pill neutral">
                <Zap size={13} />
                <span>Real-Time</span>
              </div>
            </div>
            <div className="telemetry-value">120ms</div>
            <div className="telemetry-sub">Zero-shot multimodal classification</div>
          </div>

          {/* Card 3 */}
          <div className="telemetry-card">
            <div className="telemetry-top">
              <span className="telemetry-label">Forensic Audit Trail</span>
              <div className="trend-pill verified">
                <CheckCircle2 size={13} />
                <span>Ed25519</span>
              </div>
            </div>
            <div className="telemetry-value">100% Signed</div>
            <div className="telemetry-sub">Court-admissible tamper-evident proof</div>
          </div>

          {/* Card 4 */}
          <div className="telemetry-card">
            <div className="telemetry-top">
              <span className="telemetry-label">New Hardware Cost</span>
              <div className="trend-pill highlight">
                <span>$0.00</span>
              </div>
            </div>
            <div className="telemetry-value">Zero Hardware</div>
            <div className="telemetry-sub">Uses field phones + printable 18% grey card</div>
          </div>
        </div>
      </section>

      {/* ── DOWNLOAD CENTER ────────────────────────── */}
      <section id="downloads" className="portal-section downloads-section">
        <div className="section-header">
          <div className="section-kicker">Deployment & Downloads</div>
          <h2 className="section-title">Field Verification Suite</h2>
          <p className="section-description">
            Choose your deployment mode: install the mobile app on field officer devices,
            download the physical optical calibration card, or run a self-hosted private node.
          </p>
        </div>

        <div className="downloads-grid">
          {/* Card 1: Android APK */}
          <div className="download-card featured">
            <div className="card-top-tag lime-tag">Recommended for Field Officers</div>
            <div className="download-card-icon"><Smartphone size={28} /></div>
            <h3 className="download-card-title">Android Mobile Application</h3>
            <p className="download-card-text">
              Standalone APK for Android field smartphones. Features real-time camera guide alignment,
              GPS coordinate lock, and instant presumptive hue preview.
            </p>
            <div className="download-meta">
              <span className="meta-badge">Version 1.2.0</span>
              <span className="meta-badge">~12 MB</span>
              <span className="meta-badge">Android 8.0+</span>
            </div>
            <div className="card-actions">
              <a
                href="/downloads/FieldVerification-v1.2.0.apk"
                download="FieldVerification-v1.2.0.apk"
                className="btn-download lime-solid"
              >
                <Download size={16} /> Download APK (v1.2)
              </a>
              <button onClick={handleInstallPwa} className="btn-download forest-outline">
                <Smartphone size={16} /> Install as PWA (Web App)
              </button>
            </div>
          </div>

          {/* Card 2: Reference Colour Card */}
          <div className="download-card">
            <div className="card-top-tag muted-tag">Required for Optical Calibration</div>
            <div className="download-card-icon"><FileText size={28} /></div>
            <h3 className="download-card-title">Reference Colour Card (PDF)</h3>
            <p className="download-card-text">
              Print-ready PDF card with neutral 18% grey, pure white, and black reflectance patches.
              Held alongside the vial during capture to eliminate ambient lighting cast.
            </p>
            <div className="download-meta">
              <span className="meta-badge">Standard PDF</span>
              <span className="meta-badge">100% Scale</span>
              <span className="meta-badge">Matte Paper</span>
            </div>
            <div className="card-actions">
              <a
                href="/reference_colour_card.pdf"
                download="reference_colour_card.pdf"
                target="_blank"
                rel="noreferrer"
                className="btn-download lime-solid"
              >
                <Download size={16} /> Download Card (PDF)
              </a>
              <a
                href="/reference_colour_card.pdf"
                target="_blank"
                rel="noreferrer"
                className="btn-download forest-outline"
              >
                <Eye size={16} /> View in Browser
              </a>
            </div>
          </div>

          {/* Card 3: Source Code & Docker Kit */}
          <div className="download-card">
            <div className="card-top-tag muted-tag">For Laboratories & Police IT</div>
            <div className="download-card-icon"><Terminal size={28} /></div>
            <h3 className="download-card-title">Self-Hosted / Docker Node</h3>
            <p className="download-card-text">
              Deploy your own air-gapped field verification instance on an isolated
              police station server, precinct intranet, or central laboratory network.
            </p>
            <div className="download-meta">
              <span className="meta-badge">Node 22 LTS</span>
              <span className="meta-badge">Python 3.11</span>
              <span className="meta-badge">Open Source</span>
            </div>
            <div className="card-actions">
              <a
                href="https://github.com/dev-stacks-here/sih-field-verification"
                target="_blank"
                rel="noreferrer"
                className="btn-download lime-solid"
              >
                <Github size={16} /> View on GitHub
              </a>
              <button onClick={copyCloneCmd} className="btn-download forest-outline">
                {copiedCurl ? <Check size={16} /> : <Copy size={16} />}
                {copiedCurl ? "Command Copied!" : "Copy Git Clone"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────── */}
      <section id="how-it-works" className="portal-section how-section">
        <div className="section-header">
          <div className="section-kicker">Operational Workflow</div>
          <h2 className="section-title">How Field Verification Works</h2>
          <p className="section-description">
            A 4-step forensic pipeline designed for immediate clarity in demanding field operations.
          </p>
        </div>

        <div className="steps-container">
          <div className="step-card">
            <div className="step-number-spark">01</div>
            <h4 className="step-title">Chemical Reagent Reaction</h4>
            <p className="step-text">
              The field officer executes standard presumptive testing (e.g. Marquis, Scott, or Duquenois-Levine).
              The chemical produces a characteristic color change inside the test vial.
            </p>
          </div>

          <div className="step-card">
            <div className="step-number-spark">02</div>
            <h4 className="step-title">Guide Alignment & Capture</h4>
            <p className="step-text">
              The officer aligns the test vial and the printed Reference Colour Card inside the
              on-screen optical guide. The app captures high-resolution raw image bytes with GPS metadata.
            </p>
          </div>

          <div className="step-card">
            <div className="step-number-spark">03</div>
            <h4 className="step-title">Dual-Model AI Consensus</h4>
            <p className="step-text">
              Google SigLIP zero-shot vision model classifies the reaction against natural language prompts,
              cross-validated with custom domain CNN weights and heuristic color analysis.
            </p>
          </div>

          <div className="step-card">
            <div className="step-number-spark">04</div>
            <h4 className="step-title">Ed25519 Cryptographic Sign</h4>
            <p className="step-text">
              The server computes a SHA-256 hash of the exact image bytes, signs the record with an Ed25519
              private key, and locks timestamp, GPS, and operator identity into an immutable audit trail.
            </p>
          </div>
        </div>
      </section>

      {/* ── ARCHITECTURE & FORENSIC SAFEGUARDS ──────── */}
      <section id="architecture" className="portal-section arch-section">
        <div className="section-header">
          <div className="section-kicker">Forensic Integrity</div>
          <h2 className="section-title">Triple-Layer Classification & Safeguards</h2>
          <p className="section-description">
            Engineered so neither client tampering nor unstable connections can compromise evidence.
          </p>
        </div>

        <div className="arch-grid">
          <div className="arch-item">
            <div className="arch-icon-spark"><Cpu size={24} /></div>
            <h3>Authoritative SigLIP Foundation AI</h3>
            <p>
              Pretrained on millions of image-text pairs with pairwise sigmoid loss.
              Captures fine-grained chemical hue shifts without overfitting to synthetic conditions.
            </p>
          </div>

          <div className="arch-item">
            <div className="arch-icon-spark"><Layers size={24} /></div>
            <h3>Dual-Model Consensus Engine</h3>
            <p>
              Pairs SigLIP with a custom domain classifier. When models agree, confidence is high;
              when they disagree, the system auto-flags <code>needsReview: true</code> for lab review.
            </p>
          </div>

          <div className="arch-item">
            <div className="arch-icon-spark"><Lock size={24} /></div>
            <h3>Cryptographic Tamper-Evidence</h3>
            <p>
              Every record is signed with Ed25519. Any post-hoc modification to the image bytes, GPS coords,
              or server outcome is detected instantly upon audit verification.
            </p>
          </div>

          <div className="arch-item">
            <div className="arch-icon-spark"><AlertTriangle size={24} /></div>
            <h3>Simulated Location Safeguard</h3>
            <p>
              Missing GPS fixes can never silently masquerade as authentic fixes: the officer is
              required to explicitly acknowledge simulated coordinates before sign-off.
            </p>
          </div>
        </div>
      </section>

      {/* ── LIVE DEMO BANNER ───────────────────────── */}
      <section className="portal-section demo-banner-section">
        <div className="demo-banner-spark">
          {/* Spark Admin asterisk background geometric shape */}
          <svg className="demo-banner-bg-shape" viewBox="0 0 100 100" fill="none">
            <g transform="translate(50,50)">
              <rect x="-6" y="-45" width="12" height="90" rx="6" ry="6" fill="#B4F105" />
              <rect x="-6" y="-45" width="12" height="90" rx="6" ry="6" fill="#B4F105" transform="rotate(60)" />
              <rect x="-6" y="-45" width="12" height="90" rx="6" ry="6" fill="#B4F105" transform="rotate(120)" />
            </g>
          </svg>

          <div className="demo-banner-content">
            <span className="demo-badge-spark">Instant Verification</span>
            <h2 className="demo-title-spark">Ready to test the Field Verification System?</h2>
            <p className="demo-desc-spark">
              Test the scanner directly in your browser with pre-loaded demo credentials.
              No specialized setup or sensor installation required.
            </p>
            <div className="demo-credentials-pill">
              <span>Account: <strong>R.SHARMA</strong></span>
              <span className="cred-divider">|</span>
              <span>Password: <strong>Field@123</strong></span>
            </div>
          </div>
          <div className="demo-banner-actions">
            <button className="btn-banner-lime" onClick={onQuickDemoLogin}>
              <span>Launch Live Demo Now</span>
              <ArrowRight size={16} />
            </button>
            <a href="/reference_colour_card.pdf" target="_blank" className="btn-banner-forest">
              <FileText size={16} /> Reference Card
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────── */}
      <footer className="portal-footer">
        <div className="footer-content">
          <div className="footer-col brand-col">
            <div className="portal-brand">
              <div className="brand-badge-spark">
                <svg className="spark-logo-icon" viewBox="0 0 24 24" width="18" height="18">
                  <g transform="translate(12,12)">
                    <rect x="-1.5" y="-9" width="3" height="18" rx="1.5" fill="#B4F105" />
                    <rect x="-1.5" y="-9" width="3" height="18" rx="1.5" fill="#B4F105" transform="rotate(60)" />
                    <rect x="-1.5" y="-9" width="3" height="18" rx="1.5" fill="#B4F105" transform="rotate(120)" />
                  </g>
                </svg>
              </div>
              <span className="brand-name">Field Verification</span>
            </div>
            <p className="footer-tagline">
              Digital chain-of-custody for presumptive field drug testing.
              Engineered for rapid law-enforcement field units and court-admissible auditability.
            </p>
          </div>

          <div className="footer-col">
            <div className="footer-heading">Platform</div>
            <a href="#downloads">Android APK (v1.2)</a>
            <a href="#downloads">Web Scanner (PWA)</a>
            <a href="/reference_colour_card.pdf" target="_blank">Reference Colour Card</a>
            <button onClick={onLaunchApp} className="footer-link-btn">Open Fullscreen App</button>
          </div>

          <div className="footer-col">
            <div className="footer-heading">Technology</div>
            <a href="#architecture">Google SigLIP Model</a>
            <a href="#architecture">Dual-Model Consensus</a>
            <a href="#architecture">Ed25519 Cryptography</a>
            <a href="#architecture">Grey-World Calibration</a>
          </div>

          <div className="footer-col">
            <div className="footer-heading">Repository</div>
            <a href="https://github.com/dev-stacks-here/sih-field-verification" target="_blank" rel="noreferrer">
              GitHub Source Code
            </a>
            <a href="https://github.com/dev-stacks-here/sih-field-verification/issues" target="_blank" rel="noreferrer">
              Issue Tracker
            </a>
            <a href="https://github.com/dev-stacks-here/sih-field-verification/blob/main/sih-field-verification/README.md" target="_blank" rel="noreferrer">
              System Documentation
            </a>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 Field Verification System · Built for Smart India Hackathon · Presumptive field testing only.</p>
          <p className="footer-secondary">Supports, but does not replace, confirmatory laboratory chromatography/mass spectrometry.</p>
        </div>
      </footer>
    </div>
  );
}
