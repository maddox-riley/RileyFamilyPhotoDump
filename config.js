// ============================================================
// Riley Family App — Configuration
// ============================================================
// Replace placeholder values with your real API keys before deploying.
// NEVER commit real API keys to a public repository.

const CONFIG = {

  // ----------------------------------------------------------
  // Anthropic API — AI-generated member summaries & family moment
  // Get your key at: https://console.anthropic.com
  // ----------------------------------------------------------
  ANTHROPIC_API_KEY: 'YOUR_ANTHROPIC_API_KEY_HERE',
  ANTHROPIC_MODEL: 'claude-sonnet-4-20250514',
  ANTHROPIC_MAX_TOKENS: 1000,

  // ----------------------------------------------------------
  // AeroDataBox via RapidAPI — live flight tracking
  // Sign up at: https://rapidapi.com/aedbx-aedbx/api/aerodatabox
  // Subscribe to the "Basic" (free) plan.
  // ----------------------------------------------------------
  RAPIDAPI_KEY: 'YOUR_RAPIDAPI_KEY_HERE',
  AERODATABOX_HOST: 'aerodatabox.p.rapidapi.com',

  // ----------------------------------------------------------
  // Firebase Realtime Database — cross-device sync (optional)
  // Setup: https://console.firebase.google.com → New project → Realtime Database
  // In Database Rules tab, set: { "rules": { ".read": true, ".write": true } }
  // ----------------------------------------------------------
  FIREBASE_CONFIG: {
    apiKey:            'YOUR_FIREBASE_API_KEY',
    authDomain:        'YOUR_PROJECT_ID.firebaseapp.com',
    databaseURL:       'https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com',
    projectId:         'YOUR_PROJECT_ID',
    storageBucket:     'YOUR_PROJECT_ID.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId:             'YOUR_APP_ID',
  },

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
