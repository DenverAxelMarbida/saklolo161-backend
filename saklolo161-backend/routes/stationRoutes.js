/**
 * routes/stationRoutes.js
 * --------------------------------------------------------------
 * Station + assigned-unit endpoints. Two auth tiers (same pattern
 * as routes/userRoutes.js):
 *
 *   - GET / and GET /:id → verifyAuth ONLY. Any authenticated
 *     dispatcher or admin may read. Dispatchers always receive
 *     active records only (controller hides inactive ones);
 *     admins may pass ?includeInactive=true.
 *   - Everything else → verifyAuth + requireAdmin (403 for
 *     non-admins).
 *
 * Intentionally NO DELETE route: stations and units are
 * deactivated (PATCH /:id/status, PATCH /:id/units/:unitId/status),
 * never deleted, so historical dispatch attribution survives.
 * Mounted at /api/stations in server.js.
 * --------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const verifyAuth = require('../middlewares/verifyAuth');
const requireAdmin = require('../middlewares/requireAdmin');
const {
  listStations,
  getStation,
  createStation,
  updateStation,
  setStationStatus,
  addUnit,
  updateUnit,
  setUnitStatus,
} = require('../controllers/stationController');

// GET /api/stations - list stations (active only, unless admin ?includeInactive=true)
router.get('/', verifyAuth, listStations);

// POST /api/stations - create a station (admin only)
router.post('/', verifyAuth, requireAdmin, createStation);

// PATCH /api/stations/:id/status - activate/deactivate a station (before /:id)
router.patch('/:id/status', verifyAuth, requireAdmin, setStationStatus);

// PATCH /api/stations/:id - update station details (admin only)
router.patch('/:id', verifyAuth, requireAdmin, updateStation);

// GET /api/stations/:id - single station (inactive hidden from non-admins)
router.get('/:id', verifyAuth, getStation);

// POST /api/stations/:id/units - add a unit (admin only)
router.post('/:id/units', verifyAuth, requireAdmin, addUnit);

// PATCH /api/stations/:id/units/:unitId/status - activate/deactivate a unit (before :unitId)
router.patch('/:id/units/:unitId/status', verifyAuth, requireAdmin, setUnitStatus);

// PATCH /api/stations/:id/units/:unitId - rename a unit (admin only)
router.patch('/:id/units/:unitId', verifyAuth, requireAdmin, updateUnit);

module.exports = router;
