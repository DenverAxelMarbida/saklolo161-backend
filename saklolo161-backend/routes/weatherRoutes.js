/**
 * routes/weatherRoutes.js
 * --------------------------------------------------------------
 * Maps HTTP verbs + paths to weatherController functions.
 * Mounted at /api/weather-river in server.js.
 * --------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const { getWeatherRiver } = require('../controllers/weatherController');

// GET /api/weather-river - current weather + Marikina River snapshot
router.get('/', getWeatherRiver);

module.exports = router;
