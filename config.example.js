// ─────────────────────────────────────────────
//  LabChess — Firebase Configuration Template
//  Copy this file to config.js and add your keys
// ─────────────────────────────────────────────

const config = {
  // Firebase Web SDK credentials
  firebase: {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT.firebaseapp.com",
    databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId:         "YOUR_PROJECT_ID",
    storageBucket:     "YOUR_PROJECT.firebasestorage.app",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId:             "YOUR_APP_ID"
  },

  // App Check configuration (reCAPTCHA v3 or Debug Provider)
  appCheck: {
    enabled: false,
    siteKey: "", // Enter your reCAPTCHA v3 site key for production
    isTokenAutoRefreshEnabled: true
  },

  // Authoritative Cloud Functions configuration (optional)
  functions: {
    enabled: false,
    region: "us-central1"
  },

  // Room lifecycle & limits
  limits: {
    roomCodeLength: 6,
    roomTtlMinutes: 120, // 2 hours
    maxPlayerNameLength: 20
  }
};

export default config;
