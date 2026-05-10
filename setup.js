// ============================================================
// Riley Family — Setup Module
// Shows a first-run screen to collect API keys on Dad's device.
// OpenAI (AI summaries) + RapidAPI (flight tracking).
// All other config lives in config.js directly.
// ============================================================

window.Setup = (() => {

  const DONE_KEY = 'riley_setup_done';

  function isDone() {
    return !!localStorage.getItem(DONE_KEY);
  }

  function markDone() {
    localStorage.setItem(DONE_KEY, '1');
  }

  // ── Screen visibility ─────────────────────────────────────

  function showScreen() {
    document.getElementById('screen-setup')?.classList.add('active');
    document.getElementById('screen-auth')?.classList.remove('active');
    document.getElementById('screen-main')?.classList.remove('active');
  }

  function hideScreen() {
    document.getElementById('screen-setup')?.classList.remove('active');
  }

  // ── Save handler ──────────────────────────────────────────

  function saveAndContinue() {
    const openaiKey  = document.getElementById('setup-openai')?.value.trim();
    const rapidapiKey = document.getElementById('setup-rapidapi')?.value.trim();

    if (openaiKey) {
      localStorage.setItem('riley_key_openai', openaiKey);
      CONFIG.OPENAI_API_KEY = openaiKey;
    }
    if (rapidapiKey) {
      localStorage.setItem('riley_key_rapidapi', rapidapiKey);
      CONFIG.RAPIDAPI_KEY = rapidapiKey;
    }

    markDone();
    hideScreen();
    document.getElementById('screen-auth')?.classList.add('active');
  }

  function skip() {
    markDone();
    hideScreen();
    document.getElementById('screen-auth')?.classList.add('active');
  }

  // ── Open setup screen (from dev modal) ───────────────────

  function openSetupScreen() {
    const openaiEl   = document.getElementById('setup-openai');
    const rapidapiEl = document.getElementById('setup-rapidapi');
    if (openaiEl)   openaiEl.value   = localStorage.getItem('riley_key_openai')   || '';
    if (rapidapiEl) rapidapiEl.value = localStorage.getItem('riley_key_rapidapi') || '';
    showScreen();
  }

  // ── Generate / parse setup link ──────────────────────────

  function generateLink() {
    const openai   = localStorage.getItem('riley_key_openai')   || '';
    const rapidapi = localStorage.getItem('riley_key_rapidapi') || '';
    if (!openai && !rapidapi) return null;
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ openai, rapidapi }))));
    return `${window.location.href.split('#')[0]}#setup=${encoded}`;
  }

  function parseLink() {
    const hash = window.location.hash;
    if (!hash.startsWith('#setup=')) return null;
    try { return JSON.parse(decodeURIComponent(escape(atob(hash.slice(7))))); } catch { return null; }
  }

  // ── Wire buttons ──────────────────────────────────────────

  function wireButtons() {
    document.getElementById('setup-save-btn')?.addEventListener('click', saveAndContinue);
    document.getElementById('setup-skip-btn')?.addEventListener('click', skip);
  }

  // ── Init — returns true if setup screen was shown ─────────
  // The setup screen only shows when keys are passed via a link.
  // All other first-run devices are silently marked done and proceed
  // straight to the app. Keys are entered on Dad's device via the
  // dev modal (long-press "Riley Family" → Update API Keys).

  function init() {
    wireButtons();

    const fromLink = parseLink();

    if (fromLink?.openai || fromLink?.rapidapi) {
      // Pre-fill keys from a setup link and show screen
      const openaiEl   = document.getElementById('setup-openai');
      const rapidapiEl = document.getElementById('setup-rapidapi');
      if (openaiEl   && fromLink.openai)   openaiEl.value   = fromLink.openai;
      if (rapidapiEl && fromLink.rapidapi) rapidapiEl.value = fromLink.rapidapi;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      showScreen();
      return true;
    }

    // Auto-mark done on first run so the app is never blocked
    if (!isDone()) markDone();
    return false;
  }

  return { init, isDone, openSetupScreen, generateLink };

})();
