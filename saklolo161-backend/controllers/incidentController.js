/**
 * controllers/incidentController.js
 * --------------------------------------------------------------
 * Handles the business logic for incident-related requests.
 * Talks to /services/incidentService.js (Phase 2) and /services
 * (Mapbox, TextBee SMS) — routes stay thin and just point here.
 * --------------------------------------------------------------
 */

const incidentService = require('../services/incidentService');
const mapboxService = require('../services/mapboxService');
const stationService = require('../services/stationService');
const textbeeService = require('../services/textbeeService');

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

    // Fire-and-forget confirmation SMS to the citizen (TextBee).
    textbeeService.sendSms(
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
 * Resolves the ACTUAL responding station's display name for a status
 * SMS. Priority: the contract's top-level `station` block (written at
 * dispatch) → the `dispatch.stationName` copy → a live
 * stationService lookup by `dispatch.stationId` → a neutral fallback.
 * Never assumes or hardcodes an organization: if nothing is known
 * about the responder, the SMS says so instead of naming one.
 * (Controllers reach stations only through stationService — never
 * config/stations.js directly.)
 */
async function resolveRespondingStationName(incident) {
  if (incident.station && incident.station.name) {
    return incident.station.name;
  }
  if (incident.dispatch && incident.dispatch.stationName) {
    return incident.dispatch.stationName;
  }
  if (incident.dispatch && incident.dispatch.stationId) {
    try {
      const station = await stationService.getStationById(
        incident.dispatch.stationId
      );
      if (station && station.name) return station.name;
    } catch (error) {
      console.error(
        'incidentController: responding-station lookup failed:',
        error.message
      );
    }
  }
  return 'Not yet assigned';
}

/**
 * Builds the plain-text status-notification SMS. One template per
 * outcome — INCIDENT RESOLVED for Resolved, otherwise STATUS UPDATE
 * carrying the incident id, the new status, and the ACTUAL responding
 * station (via resolveRespondingStationName). Triggers are unchanged:
 * exactly one SMS per status change, as before.
 */
async function buildStatusSms(incident, status) {
  if (status === 'Resolved') {
    return [
      'SAKLOLO 161',
      'INCIDENT RESOLVED',
      '',
      `Incident: ${incident.incidentId}`,
      'Status: Resolved',
      '',
      'Your emergency response has been completed.',
      'Thank you for using Saklolo 161.',
    ].join('\n');
  }

  const respondingFrom = await resolveRespondingStationName(incident);
  return [
    'SAKLOLO 161',
    'STATUS UPDATE',
    '',
    `Incident: ${incident.incidentId}`,
    `Status: ${status}`,
    '',
    'Responding from:',
    respondingFrom,
    '',
    'Please keep your phone available for further updates.',
  ].join('\n');
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

    // incidentService.updateStatus() persists resolvedAt on Resolved, so
    // the re-read record below normally already carries it. The fallback
    // only covers the (defensive) case where it somehow didn't — it must
    // never OVERWRITE the stored timestamp, or the response would disagree
    // with every subsequent GET.
    if (status === 'Resolved' && !updated.resolvedAt) {
      updated.resolvedAt = new Date().toISOString();
    }

    // Notify the citizen of the status change (TextBee) — same single
    // awaited trigger as before; buildStatusSms() picks the template
    // and resolves the actual responding station (never a default).
    const statusSms = await buildStatusSms(updated, status);
    await textbeeService.sendSms(updated.citizenPhone, statusSms);

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
    const {
      evidenceUploading,
      evidenceExpectedCount,
      evidenceFailedCount,
      evidenceAttempt,
      evidenceAttemptsTotal,
    } = req.body;

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

    if (evidenceAttempt !== undefined) {
      if (!Number.isInteger(evidenceAttempt) || evidenceAttempt < 0) {
        return res.status(400).json({
          success: false,
          message: 'evidenceAttempt must be a non-negative integer.',
        });
      }
      patch.evidenceAttempt = evidenceAttempt;
    }

    if (evidenceAttemptsTotal !== undefined) {
      if (!Number.isInteger(evidenceAttemptsTotal) || evidenceAttemptsTotal < 0) {
        return res.status(400).json({
          success: false,
          message: 'evidenceAttemptsTotal must be a non-negative integer.',
        });
      }
      patch.evidenceAttemptsTotal = evidenceAttemptsTotal;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        success: false,
        message:
          'Provide at least one of: evidenceUploading, evidenceExpectedCount, evidenceFailedCount, evidenceAttempt, evidenceAttemptsTotal.',
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
