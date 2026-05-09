// ============================================================
// Riley Family App — Configuration
// ============================================================
// Replace placeholder values with your real API keys before deploying.
// NEVER commit real API keys to a public repository.

const CONFIG = {

  // ----------------------------------------------------------
  // OpenAI API — AI-generated member summaries & family moment
  // Get your key at: https://platform.openai.com/api-keys
  // gpt-4o supports both text and photo analysis (vision)
  // ----------------------------------------------------------
  OPENAI_API_KEY: localStorage.getItem('riley_key_openai') || '',
  OPENAI_MODEL: 'gpt-4o-mini',
  OPENAI_MAX_TOKENS: 1000,

  // ----------------------------------------------------------
  // AeroDataBox via RapidAPI — live flight tracking
  // Sign up at: https://rapidapi.com/aedbx-aedbx/api/aerodatabox
  // Subscribe to the "Basic" (free) plan.
  // ----------------------------------------------------------
  RAPIDAPI_KEY: localStorage.getItem('riley_key_rapidapi') || '',
  AERODATABOX_HOST: 'aerodatabox.p.rapidapi.com',

  // ----------------------------------------------------------
  // Firebase Realtime Database — cross-device sync (optional)
  // Setup: https://console.firebase.google.com → New project → Realtime Database
  // In Database Rules tab, set: { "rules": { ".read": true, ".write": true } }
  // ----------------------------------------------------------
  FIREBASE_CONFIG: (() => {
    try { return JSON.parse(localStorage.getItem('riley_key_firebase') || 'null') || {}; } catch { return {}; }
  })(),

  // ----------------------------------------------------------
  // Web Push (VAPID) — optional push notifications
  // Generate a key pair at: https://web-push-codelab.glitch.me/
  // Paste ONLY the public key here.
  // ----------------------------------------------------------
  VAPID_PUBLIC_KEY: 'YOUR_VAPID_PUBLIC_KEY_HERE',

  // ----------------------------------------------------------
  // App settings — edit these to match your family
  // ----------------------------------------------------------
  APP: {
    NAME: 'Riley Family',
    MEMBERS: ['Dad', 'Mom', 'Maddox', 'Dylan'],

    // Reveal: Wednesday at noon (day index: 0=Sun, 1=Mon, ... 6=Sat)
    REVEAL_DAY: 3,
    REVEAL_HOUR: 12,

    // Upload window opens Monday (day 1)
    UPLOAD_START_DAY: 1,

    // Dad's travel schedule
    // Days he is typically IN DALLAS (Mon–Thu)
    DAD_DALLAS_DAYS: [1, 2, 3, 4],
    // Days he is typically IN CHARLOTTE (Fri–Sun)
    DAD_CHARLOTTE_DAYS: [0, 5, 6],

    // Airport codes
    HOME_AIRPORT: 'CLT',   // Charlotte Douglas International
    WORK_AIRPORT: 'DAL',   // Dallas Love Field (change to DFW if needed)
    HOME_CITY: 'Charlotte',
    WORK_CITY: 'Dallas',
  },

  // ----------------------------------------------------------
  // Cloudinary — free photo/video cloud storage for cross-device sync
  // Sign up free at: https://cloudinary.com (25 GB free)
  // 1. Go to Settings → Upload → Add upload preset
  // 2. Set Signing Mode to "Unsigned"
  // 3. Paste the preset name below, and your Cloud Name from the dashboard
  // ----------------------------------------------------------
  CLOUDINARY_CONFIG: (() => {
    try { return JSON.parse(localStorage.getItem('riley_key_cloudinary') || 'null') || {}; } catch { return {}; }
  })(),

  // Base path for GitHub Pages deployment (used for audio file URLs)
  BASE_PATH: '/RileyFamilyPhotoDump',

  // ----------------------------------------------------------
  // Storage limits
  // ----------------------------------------------------------
  STORAGE: {
    WARN_MB: 200,  // Warn user when IndexedDB exceeds this size in MB
    MAX_MB: 500,
  },
};
