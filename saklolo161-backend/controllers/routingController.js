/**
 * controllers/routingController.js
 * --------------------------------------------------------------
 * Handles GET /api/routes — public Phase 3 endpoint that returns a
 * LineString route between two coordinates (real driving route via
 * Mapbox when configured, straight-line fallback otherwise).
 * --------------------------------------------------------------
 */

const routingService = require('../services/routingService');

const NUMERIC_PARAMS = ['fromLat', 'fromLng', 'toLat', 'toLng'];

function parseCoord(value) {
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * GET /api/routes?fromLat&fromLng&toLat&toLng
 * Querystring params are strings; we coerce + range-check them.
 */
async function getRoute(req, res, next) {
  try {
    const errors = [];

    const coords = {};
    for (const name of NUMERIC_PARAMS) {
      const raw = req.query[name];
      coords[name] = parseCoord(raw);
      if (Number.isNaN(coords[name])) {
        errors.push(`${name} must be a valid number (got "${raw}").`);
      }
    }

    const outOfRange = (v) => !Number.isNaN(v) && (v < -90 || v > 90);
    const outOfRangeLng = (v) => !Number.isNaN(v) && (v < -180 || v > 180);
    if (outOfRange(coords.fromLat) || outOfRange(coords.toLat)) {
      errors.push('latitudes must be between -90 and 90.');
    }
    if (outOfRangeLng(coords.fromLng) || outOfRangeLng(coords.toLng)) {
      errors.push('longitudes must be between -180 and 180.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors });
    }

    const data = await routingService.getRoute(
      coords.fromLat,
      coords.fromLng,
      coords.toLat,
      coords.toLng
    );

    return res.status(200).json({
      success: true,
      message: 'Route retrieved successfully.',
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getRoute };