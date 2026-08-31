/**
 * server.js
 * --------------------------------------------------------------
 * Entry point for the Saklolo 161 Middleware Gateway.
 *
 * Responsibilities:
 *  - Load environment config
 *  - Initialize Firebase (mocked in Phase 1)
 *  - Wire up global middleware (CORS, JSON parsing)
 *  - Mount API routes
 *  - Handle 404s and errors
 * --------------------------------------------------------------
 */

const express = require('express');
const cors = require('cors');

const { PORT, NODE_ENV } = require('./config/env');
const corsOptions = require('./config/corsOptions');
const { initializeFirebase } = require('./config/firebase');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');

const incidentRoutes = require('./routes/incidentRoutes');
const weatherRoutes = require('./routes/weatherRoutes');

const app = express();

// ---- Global Middleware -------------------------------------------------
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Firebase Init (mocked in Phase 1, see config/firebase.js) --------
initializeFirebase();

// ---- Health Check --------------------------------------------------------
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Saklolo 161 Middleware Gateway is running.',
    environment: NODE_ENV,
  });
});

// ---- API Routes ------------------------------------------------------------
app.use('/api/incidents', incidentRoutes);
app.use('/api/weather-river', weatherRoutes);

// ---- 404 + Error Handlers (must be registered LAST) -----------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---- Start Server -----------------------------------------------------------
app.listen(PORT, () => {
  console.log('--------------------------------------------------');
  console.log(`🚨  Saklolo 161 Middleware Gateway`);
  console.log(`🌐  Running at: http://localhost:${PORT}`);
  console.log(`🛠️   Environment: ${NODE_ENV}`);
  console.log('--------------------------------------------------');
});
