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
const authRoutes = require('./routes/authRoutes');
const routingRoutes = require('./routes/routingRoutes');
const userRoutes = require('./routes/userRoutes');
const stationRoutes = require('./routes/stationRoutes');

const app = express();

// ---- Global Middleware -------------------------------------------------
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Minimal request log: method, path, status, elapsed ms — enough to
// separate backend latency from SMS-provider delay in Render logs.
// Never logs bodies, query strings, headers, phones, or tokens.
// Capture method/path up front: routers mutate req.url while handling,
// so reading req.path in the finish callback can log a mount-relative
// path (e.g. "/login" instead of "/api/auth/login").
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const method = req.method;
  const path = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${method} ${path} ${res.statusCode} ${elapsedMs.toFixed(1)}ms`);
  });
  next();
});

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
app.use('/api/auth', authRoutes);
app.use('/api/routes', routingRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stations', stationRoutes);

// ---- 404 + Error Handlers (must be registered LAST) -----------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---- Start Server -----------------------------------------------------------
// When imported by tests (supertest), don't bind a port — export `app`
// so the test runner can drive it in-process.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('--------------------------------------------------');
    console.log(`🚨  Saklolo 161 Middleware Gateway`);
    console.log(`🌐  Running at: http://localhost:${PORT}`);
    console.log(`🛠️   Environment: ${NODE_ENV}`);
    console.log('--------------------------------------------------');
  });
}

module.exports = app;
