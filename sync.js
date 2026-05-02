// ============================================================
// Riley Family — Sync Module
// Cross-device data sync via Firebase Realtime Database.
// Falls back to localStorage if Firebase is not configured.
//
// SETUP: Add your Firebase config to config.js under FIREBASE_CONFIG.
// Firebase console: https://console.firebase.google.com
// In Realtime Database rules, set:
//   { "rules": { ".read": true, ".write": true } }
// ============================================================

window.Sync = (() => {
  let firebaseDB = null;
  let initialized = false;

  function isConfigured() {
    const cfg = CONFIG.FIREBASE_CONFIG;
    return !!(cfg && cfg.databaseURL && !cfg.databaseURL.includes('YOUR_'));
  }

  // ── Load Firebase compat SDK dynamically ──────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load: ${src}`));
      document.head.appendChild(s);
    });
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    if (!isConfigured()) {
      console.log('Sync: Firebase not configured — using localStorage only.');
      return;
    }

    try {
      const v = '10.12.0';
      await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-database-compat.js`);
      if (!firebase.apps.length) {
        firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
      }
      firebaseDB = firebase.database();
      console.log('Sync: Firebase connected.');
    } catch (e) {
      console.warn('Sync: Firebase init failed, falling back to localStorage.', e);
      firebaseDB = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  function lsKey(path) {
    return 'riley_sync_' + path.replace(/\//g, '__');
  }

  // ── Write a value ─────────────────────────────────────────
  async function set(path, value) {
    // Always write to localStorage as a local cache
    localStorage.setItem(lsKey(path), JSON.stringify(value));

    if (firebaseDB) {
      try {
        await firebaseDB.ref(path).set(value);
      } catch (e) {
        console.warn('Sync.set firebase error:', e);
      }
    }
  }

  // ── Read a value once ─────────────────────────────────────
  async function get(path) {
    if (firebaseDB) {
      try {
        const snap = await firebaseDB.ref(path).get();
        const val = snap.exists() ? snap.val() : null;
        // Update local cache
        if (val !== null) localStorage.setItem(lsKey(path), JSON.stringify(val));
        return val;
      } catch (e) {
        console.warn('Sync.get firebase error:', e);
      }
    }
    // Fallback to localStorage
    const raw = localStorage.getItem(lsKey(path));
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  // ── Subscribe to real-time changes ────────────────────────
  // Calls callback immediately with current value, then on every update.
  // Returns an unsubscribe function.
  function subscribe(path, callback) {
    if (firebaseDB) {
      const ref = firebaseDB.ref(path);
      const handler = snap => {
        const val = snap.exists() ? snap.val() : null;
        if (val !== null) localStorage.setItem(lsKey(path), JSON.stringify(val));
        callback(val);
      };
      ref.on('value', handler);
      return () => ref.off('value', handler);
    }

    // Without Firebase: read once from localStorage
    const raw = localStorage.getItem(lsKey(path));
    try { callback(raw ? JSON.parse(raw) : null); } catch { callback(null); }
    return () => {};
  }

  // ── Remove a value ────────────────────────────────────────
  async function remove(path) {
    localStorage.removeItem(lsKey(path));
    if (firebaseDB) {
      try { await firebaseDB.ref(path).remove(); } catch (e) {
        console.warn('Sync.remove firebase error:', e);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────
  return { init, set, get, subscribe, remove, isConfigured };

})();
