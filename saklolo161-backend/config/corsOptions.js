/**
 * config/corsOptions.js
 * --------------------------------------------------------------
 * Dynamic CORS configuration for development & deployment.
 * --------------------------------------------------------------
 */

const allowedOrigins = [
  'http://localhost:3000',   // React Web Dashboard (Create React App)
  'http://localhost:5173',   // React Web Dashboard (Vite)
  'http://localhost:19006',  // React Native Expo Web
  'http://localhost:8081',   // Metro Bundler
  'exp://127.0.0.1:19000',   // Expo Go local
  // Add your teammates' deployed web domains here later:
  // 'https://saklolo161-web.onrender.com',
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
      console.warn(`⚠️ CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  credentials: true,
};

module.exports = corsOptions;