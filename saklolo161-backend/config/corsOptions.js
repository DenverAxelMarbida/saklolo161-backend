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
    // 1. Allow mobile native apps, Postman, curl, and server-to-server requests (no origin header)
    if (!origin) return callback(null, true);

    // 2. Allow local network IPs during testing (e.g. 192.168.x.x or 10.x.x.x)
    const isLocalNetwork = /^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);

    // 3. Allow explicitly listed origins or local network IPs
    if (allowedOrigins.includes(origin) || isLocalNetwork || process.env.NODE_ENV !== 'production') {
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
