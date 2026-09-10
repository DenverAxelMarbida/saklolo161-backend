/**
 * controllers/incidentController.js
 * --------------------------------------------------------------
 * Handles the business logic for incident-related requests.
 * Talks to /services/incidentService.js (Phase 2) and /services
 * (Mapbox, Semaphore) — routes stay thin and just point here.
 * --------------------------------------------------------------
 */

const incidentService = require('../services/incidentService');
const mapboxService = require('../services/mapboxService');
const semaphoreService = require('../services/semaphoreService');

const VALID_STATUSES = ['Pending', 'Dispatched', 'En Route', 'Resolved'];

/**
 * Derives minutes elapsed since the incident was reported. The web
 * dashboard shows "Xm ago" from this value. Falls back to 0 when a
 * timestamp is missing or malformed so the UI never shows NaN.
 */
function deriveElapsedMinutes(timestamp) {
  const ts = timestamp ? new Date(timestamp).getTime() : NaN;
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

/**
 * Generates a mock incidentId in the format INC-YYYYMMDD-XXXX
 */
function generateIncidentId() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const randomPart = Math.floor(1000 + Math.random() * 9000); // 4-digit number
  return `INC-${datePart}-${randomPart}`;
}

/**
 * POST /api/incidents
 * Receives raw GPS + category from the mobile app, validates it
 * (see middlewares/validateIncident.js), reverse-geocodes the
 * address, and stores the new incident.
 */
async function createIncident(req, res, next) {
  try {
    const { citizenPhone, category, location, notes } = req.body;
    const rawExpectedCount = Number(req.body.evidenceExpectedCount);
    const evidenceExpectedCount =
      Number.isFinite(rawExpectedCount) && rawExpectedCount > 0
        ? Math.floor(rawExpectedCount)
        : 0;

    // Reverse-geocode the coordinates into a readable address.
    const address = await mapboxService.reverseGeocode(
      location.latitude,
      location.longitude
    );

    const newIncident = {
      incidentId: generateIncidentId(),
      citizenPhone,
      category,
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        address,
      },
      status: 'Pending',
      notes: notes || '',
      timestamp: new Date().toISOString(),
      // Additive evidence-upload fields (client-contract-safe): the mobile
      // app knows how many attachments it will push right after submit, so
      // this flips uploads to "inbound" immediately; updateEvidenceStatus
      // flips it off when the loop finishes.
      evidenceExpectedCount,
      evidenceUploading: evidenceExpectedCount > 0,
      evidenceFailedCount: 0,
    };

    await incidentService.add(newIncident);

    // Fire-and-forget confirmation SMS to the citizen (mocked in Phase 1).
    semaphoreService.sendSms(
      citizenPhone,
      `Saklolo 161: Your ${category} report (${newIncident.incidentId}) has been received. Help is on the way.`
    );

    return res.status(201).json({
      success: true,
      message: 'Incident created successfully.',
      data: {
        ...newIncident,
        elapsedMinutes: deriveElapsedMinutes(newIncident.timestamp),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/incidents
 * Returns all incidents for admins (agency "ALL"). For agency-scoped
 * dispatchers, returns only incidents whose category matches their
 * agency (case-insensitive). Requires verifyAuth (sets req.user).
 */
async function getIncidents(req, res, next) {
  try {
    const incidents = await incidentService.getAll();

    const { agency } = req.user;

    const filtered =
      agency === 'ALL'
        ? incidents
        : incidents.filter(
            (incident) => incident.category.toLowerCase() === agency.toLowerCase()
          );

    return res.status(200).json({
      success: true,
      count: filtered.length,
      data: filtered.map((incident) => ({
        ...incident,
        elapsedMinutes: deriveElapsedMinutes(incident.timestamp),
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/incidents/:id
 * Returns a single incident by ID. Useful for detail screens.
 */
async function getIncidentById(req, res, next) {
  try {
    const { id } = req.params;
    const incident = await incidentService.findById(id);

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident ${id} not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...incident,
        elapsedMinutes: deriveElapsedMinutes(incident.timestamp),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/incidents/:id/status
 * Simulates the Pending -> Dispatched -> Resolved lifecycle.
 * The Admin Web Dashboard will call this when a dispatcher
 * updates an incident's status.
 */
async function updateIncidentStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${VALID_STATUSES.join(', ')}.`,
      });
    }

    const incident = await incidentService.findById(id);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident ${id} not found.`,
      });
    }

    const updated = await incidentService.updateStatus(id, status);

    if (status === 'Resolved') {
      updated.resolvedAt = new Date().toISOString();
    }

    // Notify the citizen of the status change (mocked in Phase 1).
    await semaphoreService.sendSms(
      updated.citizenPhone,
      `Saklolo 161: Your incident ${updated.incidentId} status is now "${status}".`
    );

    return res.status(200).json({
      success: true,
      message: `Incident ${id} status updated to "${status}".`,
      data: {
        ...updated,
        elapsedMinutes: deriveElapsedMinutes(updated.timestamp),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/incidents/:id/evidence-status
 * Public, rate-limited. The mobile client signals evidence-upload
 * progress so the web dashboard can tell dispatchers the report's
 * attachments are still inbound (or partially failed). Only the three
 * additive evidence fields may be updated here.
 */
async function updateEvidenceStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { evidenceUploading, evidenceExpectedCount, evidenceFailedCount } = req.body;

    const patch = {};

    if (evidenceUploading !== undefined) {
      if (typeof evidenceUploading !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'evidenceUploading must be a boolean.',
        });
      }
      patch.evidenceUploading = evidenceUploading;
    }

    if (evidenceExpectedCount !== undefined) {
      if (!Number.isInteger(evidenceExpectedCount) || evidenceExpectedCount < 0) {
        return res.status(400).json({
          success: false,
          message: 'evidenceExpectedCount must be a non-negative integer.',
        });
      }
      patch.evidenceExpectedCount = evidenceExpectedCount;
    }

    if (evidenceFailedCount !== undefined) {
      if (!Number.isInteger(evidenceFailedCount) || evidenceFailedCount < 0) {
        return res.status(400).json({
          success: false,
          message: 'evidenceFailedCount must be a non-negative integer.',
        });
      }
      patch.evidenceFailedCount = evidenceFailedCount;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one of: evidenceUploading, evidenceExpectedCount, evidenceFailedCount.',
      });
    }

    const existing = await incidentService.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: `Incident ${id} not found.`,
      });
    }

    const updated = await incidentService.updateEvidenceStatus(id, patch);

    return res.status(200).json({
      success: true,
      message: `Evidence upload status updated for incident ${id}.`,
      data: {
        ...updated,
        elapsedMinutes: deriveElapsedMinutes(updated.timestamp),
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createIncident,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
  updateEvidenceStatus,
};
