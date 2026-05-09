// ============================================================
// Riley Family App — Configuration
// ============================================================
// Firebase and Cloudinary configs are safe to commit — they are
// public identifiers, not secrets. Security comes from Firebase
// rules and Cloudinary's unsigned preset scope, not hidden keys.
//
// The ONE thing kept out of this file: OPENAI_API_KEY (has billing).
// Enter it once on Dad's device via the setup screen on first launch.
// ============================================================

const CONFIG = {

  // ----------------------------------------------------------
  // OpenAI — stored in localStorage only (billing attached)
  // Enter once on Dad's device via the setup screen.
  // ----------------------------------------------------------
  OPENAI_API_KEY:  localStorage.getItem('riley_key_openai') || '',
  OPENAI_MODEL:    'gpt-4o-mini',
  OPENAI_MAX_TOKENS: 1000,

  // ----------------------------------------------------------
  // AeroDataBox via RapidAPI — live flight tracking
  // Sign up free at: https://rapidapi.com → search AeroDataBox
  // ----------------------------------------------------------
  RAPIDAPI_KEY:      '915e3471f4msh886089258e1f998p110383jsn623b2297d589',
  AERODATABOX_HOST:  'aerodatabox.p.rapidapi.com',

  // ----------------------------------------------------------
  // Firebase Realtime Database — cross-device sync
  // These are public client identifiers, safe to commit.
  // Docs: https://console.firebase.google.com
  // Rules: { "rules": { ".read": true, ".write": true } }
  // ----------------------------------------------------------
  FIREBASE_CONFIG: {
    apiKey:            'AIzaSyAchXiXsesZDM8gAAA-SbuRmHcjzVbyteE',
    authDomain:        'rileyfamily-a6684.firebaseapp.com',
    databaseURL:       'https://rileyfamily-a6684-default-rtdb.firebaseio.com',
    projectId:         'rileyfamily-a6684',
    storageBucket:     'rileyfamily-a6684.firebasestorage.app',
    messagingSenderId: '152414020596',
    appId:             '1:152414020596:web:223a08f530828bc7c90fa1',
  },

  // ----------------------------------------------------------
  // Cloudinary — photo/video sync (25 GB free)
  // Unsigned upload preset = no secret needed, safe to commit.
  // Docs: https://cloudinary.com → Settings → Upload → Add preset
  // ----------------------------------------------------------
  CLOUDINARY_CONFIG: {
    cloudName:    'drxo3qwgk',
    uploadPreset: 'RileyFamily',
  },

  // ----------------------------------------------------------
  // App settings
  // ----------------------------------------------------------
  APP: {
    NAME:    'Riley Family',
    MEMBERS: ['Maddox', 'Dylan', 'Mom', 'Dad'],

    DAD_DALLAS_DAYS:   [1, 2, 3, 4],
    DAD_CHARLOTTE_DAYS:[0, 5, 6],

    HOME_AIRPORT: 'CLT',
    WORK_AIRPORT: 'DAL',
    HOME_CITY:    'Charlotte',
    WORK_CITY:    'Dallas',
  },

  BASE_PATH: '/RileyFamilyPhotoDump',

  STORAGE: {
    WARN_MB: 200,
    MAX_MB:  500,
  },
};
