/**
 * routes/incidentRoutes.js
 * --------------------------------------------------------------
 * Maps HTTP verbs + paths to controller functions.
 * Mounted at /api/incidents in server.js.
 * --------------------------------------------------------------
 */

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();

const {
  createIncident,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
  updateEvidenceStatus,
} = require('../controllers/incidentController');
const { dispatchIncident } = require('../controllers/dispatchController');
const {
  addEvidence,
  getEvidenceMedia,
} = require('../controllers/evidenceController');
const { UPLOAD_DIR } = require('../services/evidenceService');

const validateIncident = require('../middlewares/validateIncident');
const verifyAuth = require('../middlewares/verifyAuth');
const incidentRateLimiter = require('../middlewares/rateLimitIncidents');
const {
  evidenceRateLimiter,
  mediaRateLimiter,
} = require('../middlewares/rateLimitPublic');

// Uploaded evidence lands on disk (uploads/evidence/), named by its
// fileId so the media endpoint can resolve bytes without a lookup map.
// The dir is place on disk rather than RAM so multi-hundred-MB videos
// never blow the process heap; like the mock incident store, it resets
// when the server is redeployed (uploads/ is gitignored).
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, `ev-${require('crypto').randomUUID()}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
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

// POST /api/incidents/:id/evidence-status - mobile signals evidence upload progress (public, IP rate-limited)
router.post('/:id/evidence-status', evidenceRateLimiter, updateEvidenceStatus);

// GET /api/incidents/:id/evidence/:fileId/media - stream stored evidence bytes (public, rate-limited)
router.get('/:id/evidence/:fileId/media', mediaRateLimiter, getEvidenceMedia);

// PATCH /api/incidents/:id/status - update incident status (dispatcher JWT)
router.patch('/:id/status', verifyAuth, updateIncidentStatus);

module.exports = router;
