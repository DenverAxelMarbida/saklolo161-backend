/**
 * routes/routingRoutes.js
 * --------------------------------------------------------------
 * Public Phase 3 routing endpoints. Mounted at /api/routes in
 * server.js. Rate-limited by IP — no auth token (mobile has none).
 * --------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const { getRoute } = require('../controllers/routingController');
const { routesRateLimiter } = require('../middlewares/rateLimitPublic');

// GET /api/routes?fromLat=..&fromLng=..&toLat=..&toLng=..
router.get('/', routesRateLimiter, getRoute);

module.exports = router;