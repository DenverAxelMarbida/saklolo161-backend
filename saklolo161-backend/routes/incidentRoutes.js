/**
 * routes/incidentRoutes.js
 * --------------------------------------------------------------
 * Maps HTTP verbs + paths to controller functions.
 * Mounted at /api/incidents in server.js.
 * --------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const {
  createIncident,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
} = require('../controllers/incidentController');
const { dispatchIncident } = require('../controllers/dispatchController');

const validateIncident = require('../middlewares/validateIncident');

// POST /api/incidents - create a new incident report
router.post('/', validateIncident, createIncident);

// POST /api/incidents/dispatch - assign a station + unit to an incident
router.post('/dispatch', dispatchIncident);

// GET /api/incidents - list all incidents (mock: 5 seeded records)
router.get('/', getIncidents);

// GET /api/incidents/:id - get a single incident by ID
router.get('/:id', getIncidentById);

// PATCH /api/incidents/:id/status - update incident status
router.patch('/:id/status', updateIncidentStatus);

module.exports = router;
