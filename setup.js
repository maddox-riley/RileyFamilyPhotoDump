// ============================================================
// Riley Family — Setup Module
// First-run configuration screen shown before profile select.
// Admin generates a setup link; others tap it and hit Save.
// ============================================================

window.Setup = (() => {

  const DONE_KEY = 'riley_setup_done';

  // ── State checks ──────────────────────────────────────────

  function isDone() {
    return !!localStorage.getItem(DONE_KEY);
  }

  function markDone() {
    localStorage.setItem(DONE_KEY, '1');
  }

  // ── Setup link encode / decode ────────────────────────────
  // Uses the URL hash (#setup=BASE64) so config is never sent
  // to any server — it stays entirely in the browser.

  function generateLink() {
    const data = {};
    const fb = localStorage.getItem('riley_key_firebase');
    const cl = localStorage.getItem('riley_key_cloudinary');
    const oa = localStorage.getItem('riley_key_openai');
    const ra = localStorage.getItem('riley_key_rapidapi');
    if (fb) try { data.firebase   = JSON.parse(fb); } catch {}
    if (cl) try { data.cloudinary = JSON.parse(cl); } catch {}
    if (oa) data.openai   = oa;
    if (ra) data.rapidapi = ra;

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    const base    = window.location.href.split('#')[0];
    return `${base}#setup=${encoded}`;
  }

  function parseLink() {
    const hash = window.location.hash;
    if (!hash.startsWith('#setup=')) return null;
    try {
      return JSON.parse(decodeURIComponent(escape(atob(hash.slice(7)))));
    } catch { return null; }
  }

  // ── Apply config to localStorage + live CONFIG ────────────

  function applyConfig(data) {
    if (data.firebase) {
      localStorage.setItem('riley_key_firebase', JSON.stringify(data.firebase));
      CONFIG.FIREBASE_CONFIG = data.firebase;
    }
    if (data.cloudinary) {
      localStorage.setItem('riley_key_cloudinary', JSON.stringify(data.cloudinary));
      CONFIG.CLOUDINARY_CONFIG = data.cloudinary;
    }
    if (data.openai) {
      localStorage.setItem('riley_key_openai', data.openai);
      CONFIG.OPENAI_API_KEY = data.openai;
    }
    if (data.rapidapi) {
      localStorage.setItem('riley_key_rapidapi', data.rapidapi);
      CONFIG.RAPIDAPI_KEY = data.rapidapi;
    }
  }

  // ── Read form fields ──────────────────────────────────────

  function readForm() {
    const data = {};

    // Firebase — accept raw JSON or pasted JS snippet
    const fbRaw = document.getElementById('setup-firebase')?.value.trim();
    if (fbRaw) {
      let parsed = null;
      // Try plain JSON first
      try { parsed = JSON.parse(fbRaw); } catch {}
      // Fall back to extracting {...} from a JS const snippet
      if (!parsed) {
        const match = fbRaw.match(/\{[\s\S]*\}/);
        if (match) try { parsed = JSON.parse(match[0]); } catch {}
      }
      if (parsed) data.firebase = parsed;
    }

    // Cloudinary — individual fields
    const cloudName    = document.getElementById('setup-cloudname')?.value.trim();
    const uploadPreset = document.getElementById('setup-preset')?.value.trim();
    if (cloudName || uploadPreset) data.cloudinary = { cloudName, uploadPreset };

    // OpenAI
    const openai = document.getElementById('setup-openai')?.value.trim();
    if (openai) data.openai = openai;

    return data;
  }

  // ── Fill form from config data ────────────────────────────

  function fillForm(data) {
    if (data.firebase) {
      const el = document.getElementById('setup-firebase');
      if (el) el.value = JSON.stringify(data.firebase, null, 2);
    }
    if (data.cloudinary) {
      const cn = document.getElementById('setup-cloudname');
      const up = document.getElementById('setup-preset');
      if (cn) cn.value = data.cloudinary.cloudName    || '';
      if (up) up.value = data.cloudinary.uploadPreset || '';
    }
    if (data.openai) {
      const el = document.getElementById('setup-openai');
      if (el) el.value = data.openai;
    }
  }

  // ── Screen visibility ─────────────────────────────────────

  function showScreen() {
    document.getElementById('screen-setup')?.classList.add('active');
    document.getElementById('screen-auth')?.classList.remove('active');
    document.getElementById('screen-main')?.classList.remove('active');
  }

  function hideScreen() {
    document.getElementById('screen-setup')?.classList.remove('active');
    // Remove setup hash so refresh doesn't re-trigger setup
    if (window.location.hash.startsWith('#setup=')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  // ── Save handler ──────────────────────────────────────────

  async function saveAndContinue() {
    const data = readForm();

    if (data.firebase && !data.firebase.databaseURL) {
      alert('Firebase config is missing "databaseURL". Copy the full config from the Firebase console and try again.');
      return;
    }

    applyConfig(data);
    markDone();

    // Connect Firebase straight away — no reload needed
    if (data.firebase && window.Sync) {
      await Sync.init(true);
    }

    hideScreen();
    // Hand off to App — show auth screen
    document.getElementById('screen-auth')?.classList.add('active');
  }

  function skip() {
    markDone();
    hideScreen();
    document.getElementById('screen-auth')?.classList.add('active');
  }

  // ── Wire buttons ──────────────────────────────────────────

  function wireButtons() {
    document.getElementById('setup-save-btn')?.addEventListener('click', saveAndContinue);
    document.getElementById('setup-skip-btn')?.addEventListener('click', skip);
  }

  // ── Public: open setup screen from dev modal ──────────────

  function openSetupScreen() {
    // Pre-fill with existing saved keys so admin can review/edit
    const existing = {};
    const fb = localStorage.getItem('riley_key_firebase');
    const cl = localStorage.getItem('riley_key_cloudinary');
    const oa = localStorage.getItem('riley_key_openai');
    if (fb) try { existing.firebase   = JSON.parse(fb); } catch {}
    if (cl) try { existing.cloudinary = JSON.parse(cl); } catch {}
    if (oa) existing.openai = oa;
    fillForm(existing);
    showScreen();
  }

  // ── Init ──────────────────────────────────────────────────
  // Returns true if the setup screen was shown (app.js should
  // skip its normal auth flow in that case).

  function init() {
    wireButtons();

    const fromLink = parseLink();

    if (isDone() && !fromLink) return false; // already set up, no new link

    showScreen();

    if (fromLink) {
      fillForm(fromLink);
      document.getElementById('setup-link-banner')?.classList.remove('hidden');
    } else {
      // Pre-fill any keys already saved on this device
      openSetupScreen();
    }

    return true;
  }

  // ── Public API ────────────────────────────────────────────
  return { init, isDone, generateLink, openSetupScreen };

})();
