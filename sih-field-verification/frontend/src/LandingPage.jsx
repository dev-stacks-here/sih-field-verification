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
      {/* ── TOP NAVIGATION ────────────────────────── */}
      <header className="portal-header">
        <div className="portal-nav-container">
          <div className="portal-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <div className="brand-badge">
              <Shield size={20} className="brand-icon" />
            </div>
            <div className="brand-text">
              <span className="brand-name">Field Verification System</span>
              <span className="brand-tag">SIH Forensic Prototype</span>
            </div>
          </div>

          <nav className="portal-nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#downloads">Download App</a>
            <a href="#architecture">Dual-Model AI</a>
            <a
              href="https://github.com/dev-stacks-here/sih-field-verification"
              target="_blank"
              rel="noreferrer"
              className="github-link"
            >
              <Github size={16} /> GitHub
            </a>
          </nav>

          <div className="portal-nav-actions">
            <button className="btn-portal-secondary" onClick={onOpenLogin}>
              Officer Sign In
            </button>
            <button className="btn-portal-primary" onClick={onLaunchApp}>
              Launch Web App <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO SECTION ───────────────────────────── */}
      <section className="portal-hero">
        <div className="hero-glow glow-1" />
        <div className="hero-glow glow-2" />

        <div className="portal-hero-content">
          <div className="hero-badge">
            <Sparkles size={14} className="badge-sparkle" />
            <span>v1.2 · Powered by Google SigLIP & Dual-Model AI</span>
          </div>

          <h1 className="hero-headline">
            Digital Chain-of-Custody for <br />
            <span className="hero-gradient">Field Chemical Drug Tests</span>
          </h1>

          <p className="hero-subhead">
            Turn any smartphone into an authoritative forensic drug-verification tool.
            Zero new hardware. Pairs existing colorimetric test kits with an optical
            reference card, instant Ed25519 digital signing, GPS verification, and server-side SigLIP AI.
          </p>

          <div className="hero-cta-group">
            <button className="hero-cta-btn primary" onClick={onLaunchApp}>
              <Camera size={18} />
              <span>Use Online (Web Scanner)</span>
            </button>
            <a href="#downloads" className="hero-cta-btn secondary">
              <Download size={18} />
              <span>Download Application</span>
            </a>
            <button className="hero-cta-btn accent" onClick={onQuickDemoLogin}>
              <ShieldCheck size={18} />
              <span>1-Click Officer Demo (R. Sharma)</span>
            </button>
          </div>

          <div className="hero-stats-grid">
            <div className="stat-card">
              <div className="stat-icon-wrapper"><Smartphone size={20} /></div>
              <div className="stat-value">Zero Hardware</div>
              <div className="stat-label">Works with existing kits + printed card</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper"><Lock size={20} /></div>
              <div className="stat-value">Ed25519 Signed</div>
              <div className="stat-label">Court-admissible tamper-evident audit log</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper"><Cpu size={20} /></div>
              <div className="stat-value">SigLIP Vision AI</div>
              <div className="stat-label">Zero-shot multimodal colorimetric classifier</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper"><MapPin size={20} /></div>
              <div className="stat-value">GPS Safeguarded</div>
              <div className="stat-label">Mandatory operator sign-off on fallback coords</div>
            </div>
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
            <span className="preview-title">Live Field Scanner Device Mockup</span>
            <button className="preview-fullscreen-btn" onClick={onLaunchApp} title="Open Fullscreen Web App">
              <ExternalLink size={14} /> Fullscreen
            </button>
          </div>
          <div className="preview-body">
            {appElement}
          </div>
          <div className="preview-footer">
            <span>Directly runnable on any modern smartphone browser (Chrome / Safari / Edge)</span>
          </div>
        </div>
      </section>

      {/* ── DOWNLOAD CENTER ────────────────────────── */}
      <section id="downloads" className="portal-section downloads-section">
        <div className="section-header">
          <div className="section-kicker">Deployment & Downloads</div>
          <h2 className="section-title">Get the Field Verification Suite</h2>
          <p className="section-description">
            Choose your deployment mode: install the mobile app on field devices,
            download the physical optical reference card, or deploy your private inspection node.
          </p>
        </div>

        <div className="downloads-grid">
          {/* Card 1: Android APK */}
          <div className="download-card featured">
            <div className="card-top-tag">Recommended for Field Officers</div>
            <div className="download-card-icon"><Smartphone size={28} /></div>
            <h3 className="download-card-title">Android Mobile Application</h3>
            <p className="download-card-text">
              Standalone APK for Android field smartphones. Includes real-time camera guide alignment,
              local GPS capture, and instant presumptive hue preview.
            </p>
            <div className="download-meta">
              <span>Version: 1.2.0</span>
              <span>Size: ~12 MB</span>
              <span>Android 8.0+</span>
            </div>
            <div className="card-actions">
              <a
                href="/downloads/FieldVerification-v1.2.0.apk"
                download="FieldVerification-v1.2.0.apk"
                className="btn-download primary"
              >
                <Download size={16} /> Download APK (v1.2)
              </a>
              <button onClick={handleInstallPwa} className="btn-download secondary">
                <Smartphone size={16} /> Install as PWA (Web App)
              </button>
            </div>
          </div>

          {/* Card 2: Reference Colour Card */}
          <div className="download-card">
            <div className="card-top-tag neutral">Required for Calibration</div>
            <div className="download-card-icon"><FileText size={28} /></div>
            <h3 className="download-card-title">Reference Colour Card (PDF)</h3>
            <p className="download-card-text">
              Print-ready PDF card with neutral 18% grey, white, and black reflectance patches.
              Held alongside the vial during capture to eliminate ambient lighting tint.
            </p>
            <div className="download-meta">
              <span>Format: Standard PDF</span>
              <span>Print: 100% Scale</span>
              <span>Matte Cardstock</span>
            </div>
            <div className="card-actions">
              <a
                href="/reference_colour_card.pdf"
                download="reference_colour_card.pdf"
                target="_blank"
                rel="noreferrer"
                className="btn-download primary"
              >
                <Download size={16} /> Download Card (PDF)
              </a>
              <a
                href="/reference_colour_card.pdf"
                target="_blank"
                rel="noreferrer"
                className="btn-download secondary"
              >
                <Eye size={16} /> View in Browser
              </a>
            </div>
          </div>

          {/* Card 3: Source Code & Docker Kit */}
          <div className="download-card">
            <div className="card-top-tag neutral">For Developers & Forensics Labs</div>
            <div className="download-card-icon"><Terminal size={28} /></div>
            <h3 className="download-card-title">Self-Hosted / Docker Node</h3>
            <p className="download-card-text">
              Deploy your own private, air-gapped field verification instance on an isolated
              police station server or forensic laboratory network.
            </p>
            <div className="download-meta">
              <span>Stack: Node 22 + Python 3.11</span>
              <span>License: Open Source</span>
            </div>
            <div className="card-actions">
              <a
                href="https://github.com/dev-stacks-here/sih-field-verification"
                target="_blank"
                rel="noreferrer"
                className="btn-download primary"
              >
                <Github size={16} /> View on GitHub
              </a>
              <button onClick={copyCloneCmd} className="btn-download secondary">
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
            A 4-step forensic pipeline designed for immediate usability in stressful field conditions.
          </p>
        </div>

        <div className="steps-container">
          <div className="step-card">
            <div className="step-number">01</div>
            <h4 className="step-title">Chemical Reagent Reaction</h4>
            <p className="step-text">
              The field officer executes standard reagent testing (e.g. Marquis, Scott, or Duquenois-Levine).
              The chemical produces a colorimetric change inside the test vial.
            </p>
          </div>

          <div className="step-card">
            <div className="step-number">02</div>
            <h4 className="step-title">Guide Alignment & Capture</h4>
            <p className="step-text">
              The officer holds the test vial alongside the physical Reference Colour Card inside the
              on-screen optical guide. The app captures high-resolution raw image bytes with GPS metadata.
            </p>
          </div>

          <div className="step-card">
            <div className="step-number">03</div>
            <h4 className="step-title">Dual-Model AI Analysis</h4>
            <p className="step-text">
              Google SigLIP zero-shot vision model classifies the cropped reaction against natural-language
              prompts, cross-checked against custom domain model weights and heuristic fallbacks.
            </p>
          </div>

          <div className="step-card">
            <div className="step-number">04</div>
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
          <h2 className="section-title">Triple-Layer Classification & Audit</h2>
          <p className="section-description">
            Engineered so neither client tampering nor cloud disconnects can compromise evidence.
          </p>
        </div>

        <div className="arch-grid">
          <div className="arch-item">
            <div className="arch-icon"><Cpu size={24} /></div>
            <h3>Authoritative SigLIP Foundation AI</h3>
            <p>
              Pretrained on millions of image-text pairs with pairwise sigmoid cross-entropy.
              Captures fine-grained chemical hue shifts without overfitting to demo photos.
            </p>
          </div>

          <div className="arch-item">
            <div className="arch-icon"><Layers size={24} /></div>
            <h3>Dual-Model Consensus Engine</h3>
            <p>
              Pairs SigLIP with a custom domain classifier. When models agree, confidence is high;
              when they disagree, the system auto-flags <code>needsReview: true</code> for lab supervisors.
            </p>
          </div>

          <div className="arch-item">
            <div className="arch-icon"><Lock size={24} /></div>
            <h3>Cryptographic Tamper-Evidence</h3>
            <p>
              Every record is signed with Ed25519. Any post-hoc modification to the image bytes, GPS coords,
              or server outcome is detected instantly upon verification.
            </p>
          </div>

          <div className="arch-item">
            <div className="arch-icon"><AlertTriangle size={24} /></div>
            <h3>Simulated Location Safeguard</h3>
            <p>
              Missing GPS fixes can never silently masquerade as authentic fixes: the officer is
              required to explicitly acknowledge manual/simulated coordinates before sign-off.
            </p>
          </div>
        </div>
      </section>

      {/* ── LIVE DEMO BANNER ───────────────────────── */}
      <section className="portal-section demo-banner-section">
        <div className="demo-banner">
          <div className="demo-banner-content">
            <div className="demo-badge">Instant Testing</div>
            <h2>Ready to test the Field Verification System?</h2>
            <p>
              Test the scanner directly in your browser with pre-loaded demo credentials.
              No setup or installation required.
            </p>
            <div className="demo-credentials-box">
              <span>Demo Account: <strong>R.SHARMA</strong></span>
              <span>Password: <strong>Field@123</strong></span>
            </div>
          </div>
          <div className="demo-banner-actions">
            <button className="btn-banner-primary" onClick={onQuickDemoLogin}>
              Launch Live Demo Now <ArrowRight size={16} />
            </button>
            <a href="/reference_colour_card.pdf" target="_blank" className="btn-banner-secondary">
              <FileText size={16} /> Download Reference Card
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────── */}
      <footer className="portal-footer">
        <div className="footer-content">
          <div className="footer-col brand-col">
            <div className="portal-brand">
              <div className="brand-badge"><Shield size={18} /></div>
              <span className="brand-name">Field Verification</span>
            </div>
            <p className="footer-tagline">
              Digital chain-of-custody for presumptive field drug testing.
              Designed for rapid law-enforcement field units and forensic auditability.
            </p>
          </div>

          <div className="footer-col">
            <div className="footer-heading">Platform</div>
            <a href="#downloads">Android APK</a>
            <a href="#downloads">Web Scanner (PWA)</a>
            <a href="/reference_colour_card.pdf" target="_blank">Reference Colour Card</a>
            <button onClick={onLaunchApp} className="footer-link-btn">Open Web App</button>
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
              Documentation
            </a>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 Field Verification System · Built for SIH · Presumptive field testing only.</p>
          <p className="footer-secondary">Supports, but does not replace, confirmatory laboratory forensics.</p>
        </div>
      </footer>
    </div>
  );
}
