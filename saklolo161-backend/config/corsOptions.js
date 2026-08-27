/**
 * config/corsOptions.js
 * --------------------------------------------------------------
 * Whitelists the local development origins used by the team:
 *   - React Native (Expo) mobile dev server
 *   - React Web Dashboard dev server (CRA / Vite)
 *
 * Add your teammate's actual dev origin here if it's different
 * (e.g. a different Vite port), or add your LAN IP if testing
 * on a physical phone over Wi-Fi (e.g. http://192.168.1.x:19006).
 * --------------------------------------------------------------
 */

const allowedOrigins = [
  'http://localhost:3000',   // React Web Dashboard (Create React App default)
  'http://localhost:5173',   // React Web Dashboard (Vite default)
  'http://localhost:19006',  // React Native / Expo web preview
  'http://localhost:8081',   // React Native Metro bundler
  'exp://127.0.0.1:19000',   // Expo Go app
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️  CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  credentials: true,
};

module.exports = corsOptions;
