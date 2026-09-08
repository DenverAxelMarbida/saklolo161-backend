/**
 * routes/incidentRoutes.js
 * --------------------------------------------------------------
 * Maps HTTP verbs + paths to controller functions.
 * Mounted at /api/incidents in server.js.
 * --------------------------------------------------------------
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();

const {
  createIncident,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
} = require('../controllers/incidentController');
const { dispatchIncident } = require('../controllers/dispatchController');
const { addEvidence } = require('../controllers/evidenceController');

const validateIncident = require('../middlewares/validateIncident');
const verifyAuth = require('../middlewares/verifyAuth');
const incidentRateLimiter = require('../middlewares/rateLimitIncidents');
const { evidenceRateLimiter } = require('../middlewares/rateLimitPublic');

// Evidence uploads: in-memory only (no disk), max 10 MB, one file.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// POST /api/incidents - create a new incident report (public: mobile entry point)
router.post('/', incidentRateLimiter, validateIncident, createIncident);

// POST /api/incidents/dispatch - assign a station + unit to an incident (dispatcher JWT)
router.post('/dispatch', verifyAuth, dispatchIncident);

// GET /api/incidents - list all incidents, agency-filtered (dispatcher JWT)
router.get('/', verifyAuth, getIncidents);

// GET /api/incidents/:id - get a single incident by ID (public: mobile status polling)
router.get('/:id', getIncidentById);

// POST /api/incidents/:id/evidence - attach a photo/file to an incident (public, IP rate-limited)
router.post('/:id/evidence', evidenceRateLimiter, upload.single('file'), addEvidence);

// PATCH /api/incidents/:id/status - update incident status (dispatcher JWT)
router.patch('/:id/status', verifyAuth, updateIncidentStatus);

module.exports = router;
