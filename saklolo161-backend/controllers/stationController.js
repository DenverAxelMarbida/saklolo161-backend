/**
 * controllers/stationController.js
 * --------------------------------------------------------------
 * Admin station + assigned-unit management, plus the active-station
 * listing dispatchers consume. Talks only to
 * services/stationService.js (never firebase-admin directly — Hard
 * Rule 2) and follows the { success, message, data } response
 * convention used across the gateway.
 *
 * Auth tiers (same pattern as routes/userRoutes.js):
 *   - GET / and GET /:id → verifyAuth ONLY. Any authenticated
 *     dispatcher or admin may list RESOURCES. Dispatchers always
 *     see active records only; admins may pass
 *     ?includeInactive=true to see everything.
 *   - Everything else → verifyAuth + requireAdmin (403 for
 *     non-admins). The backend is the real security boundary — the
 *     web hiding tabs from dispatchers is UI gating only.
 *
 * Status codes:
 *   200 GET/PATCH success · 201 POST success
 *   400 validation · 401 unauthenticated (verifyAuth)
 *   403 authenticated non-admin (requireAdmin)
 *   404 unknown station/unit · 409 duplicate id
 *   503 station store unavailable (writes only — never success:true)
 * --------------------------------------------------------------
 */

const stationService = require('../services/stationService');
const { StationError, VALID_CATEGORIES } = stationService;

function respondWithStationError(res, err) {
  if (err instanceof StationError) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
  console.error('stationController unexpected error:', err && err.message);
  return res.status(500).json({ success: false, message: 'Unexpected server error.' });
}

/**
 * GET /api/stations?category=&includeInactive=
 * Dispatchers (and unauthenticated? No — verifyAuth required) get
 * active stations only. Admins may add ?includeInactive=true.
 * ?category= filters by Title-Case backend category.
 */
async function listStations(req, res) {
  try {
    const { category, includeInactive } = req.query || {};

    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `category must be one of: ${VALID_CATEGORIES.join(', ')}.`,
      });
    }

    const wantInactive =
      String(includeInactive).toLowerCase() === 'true' && req.user && req.user.role === 'admin';

    const all = await stationService.getAllStations();
    const data = all.filter(
      (s) =>
        (wantInactive || stationService.isStationActive(s)) &&
        (!category || s.category === category)
    );

    return res.status(200).json({
      success: true,
      message: 'Stations retrieved successfully.',
      data,
    });
  } catch (err) {
    return respondWithStationError(res, err);
  }
}

/**
 * GET /api/stations/:id — single station. Inactive stations are
 * hidden from non-admins (404, same as missing) so dispatcher
 * dropdowns can never resolve a deactivated record.
 */
async function getStation(req, res) {
  try {
    const station = await stationService.getStationById(req.params.id);
    if (!station) {
      return res.status(404).json({ success: false, message: `Station ${req.params.id} not found.` });
    }
    if (!stationService.isStationActive(station) && (!req.user || req.user.role !== 'admin')) {
      return res.status(404).json({ success: false, message: `Station ${req.params.id} not found.` });
    }
    return res.status(200).json({ success: true, message: 'Station retrieved successfully.', data: station });
  } catch (err) {
    return respondWithStationError(res, err);
  }
}

/**
 * POST /api/stations (admin) — create a station.
 */
async function createStation(req, res) {
  try {
    const station = await stationService.createStation(req.body || {});
    return res.status(201).json({ success: true, message: 'Station created successfully.', data: station });
  } catch (err) {
    return respondWithStationError(res, err);
  }
}

/**
 * PATCH /api/stations/:id (admin) — update station details.
 */
async function updateStation(req, res) {
  try {
    const station = await stationService.updateStation(req.params.id, req.body || {});
    return res.status(200).json({ success: true, message: 'Station updated successfully.', data: station });
  } catch (err) {
    return respondWithStationError(res, err);
  }
}

/**
 * PATCH /api/stations/:id/status (admin) — { isActive }.
 * Deactivation is a soft-delete: incident dispatch snapshots keep
 * the historical station name.
 */
async function setStationStatus(req, res) {
  try {
    const { isActive } = req.body || {};
    const station = await stationService.setStationActive(req.params.id, isActive);
    return res.status(200).json({
      success: true,
      message: isActive ? 'Station activated.' : 'Station deactivated.',
      data: station,
    });
  } catch (err) {
    return respondWithStationError(res, err);
  }
}

/**
 * POST /api/stations/:id/units (admin) — add a unit { id, name }.
 */
async function addUnit(req, res) {
  try {
    const station = await stationService.addUnit(req.params.id, req.body || {});
    return res.status(201).json({ success: true, message: 'Unit added successfully.', data: station });
  } catch (err) {
    return respondWithStationError(res, err);
  }
}

/**
 * PATCH /api/stations/:id/units/:unitId (admin) — rename a unit.
 */
async function updateUnit(req, res) {
  try {
    const station = await stationService.updateUnit(req.params.id, req.params.unitId, req.body || {});
    return res.status(200).json({ success: true, message: 'Unit updated successfully.', data: station });
  } catch (err) {
    return respondWithStationError(res, err);
  }
}

/**
 * PATCH /api/stations/:id/units/:unitId/status (admin) — { isActive }.
 */
async function setUnitStatus(req, res) {
  try {
    const { isActive } = req.body || {};
    const station = await stationService.setUnitActive(req.params.id, req.params.unitId, isActive);
    return res.status(200).json({
      success: true,
      message: isActive ? 'Unit activated.' : 'Unit deactivated.',
      data: station,
    });
  } catch (err) {
    return respondWithStationError(res, err);
  }
}

module.exports = {
  listStations,
  getStation,
  createStation,
  updateStation,
  setStationStatus,
  addUnit,
  updateUnit,
  setUnitStatus,
};
