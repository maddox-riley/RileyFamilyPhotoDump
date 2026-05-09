// ============================================================
// Riley Family — Setup Module
// Shows a first-run screen to collect the OpenAI API key on
// Dad's device. All other config lives in config.js directly.
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
    const key = document.getElementById('setup-openai')?.value.trim();
    if (key) {
      localStorage.setItem('riley_key_openai', key);
      CONFIG.OPENAI_API_KEY = key;
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
    const el = document.getElementById('setup-openai');
    if (el) el.value = localStorage.getItem('riley_key_openai') || '';
    showScreen();
  }

  // ── Generate / parse setup link (OpenAI key only) ────────

  function generateLink() {
    const key = localStorage.getItem('riley_key_openai') || '';
    if (!key) return null;
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ openai: key }))));
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

  function init() {
    wireButtons();

    const fromLink = parseLink();

    if (fromLink?.openai) {
      // Pre-fill key from link
      const el = document.getElementById('setup-openai');
      if (el) el.value = fromLink.openai;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      showScreen();
      return true;
    }

    // Only show setup screen if OpenAI key not yet saved
    if (isDone() || localStorage.getItem('riley_key_openai')) return false;

    showScreen();
    return true;
  }

  return { init, isDone, openSetupScreen, generateLink };

})();
