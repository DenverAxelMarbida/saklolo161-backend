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
const textbeeService = require('../services/textbeeService');
const smsQueue = require('../services/smsQueue');

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

    // Fire-and-forget confirmation SMS to the citizen (TextBee) — still
    // not awaited, so the 201 never waits on the gateway, but enqueued
    // on this incident's ordered SMS chain so the confirmation can never
    // be submitted AFTER a dispatch/status text queued later. The chain
    // promise never rejects, so this can't become an unhandled
    // rejection either.
    smsQueue.enqueue(newIncident.incidentId, () =>
      textbeeService.sendSms(
        citizenPhone,
        `Saklolo 161: Your ${category} report (${newIncident.incidentId}) has been received. Help is on the way.`
      )
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
 * Builds the plain-text incident-resolution SMS (INCIDENT RESOLVED
 * carrying the incident id). Only the Resolved transition sends a
 * citizen text — intermediate statuses (Dispatched, En Route) send
 * nothing, so no responding-station resolution is needed here.
 */
async function buildStatusSms(incident, status) {
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

    // SMS policy (start/end only): the citizen gets a text for the
    // report confirmation (at creation) and for the resolution — and
    // nothing in between. Two deliberate, regression-tested rules gate
    // the resolution send:
    //   1. only a GENUINE transition to Resolved is announced (any other
    //      status, or a PATCH that changes nothing, is a no-op for SMS);
    //   2. every genuine transition still claims its announcement, so a
    //      double-click / retry / racing duplicate PATCH still yields
    //      exactly one SMS, and leaving Resolved and coming back sends
    //      again — same consecutive-duplicate guard as before.
    // Either way the response stays 200 with the normal envelope.
    //
    // ORDER MATTERS: the message is built BEFORE the write and before
    // the claim. A transient construction failure therefore surfaces
    // as a 500 with nothing persisted and no claim consumed — the same
    // PATCH can simply be retried and will announce normally (building
    // first cannot change the content: buildStatusSms only reads the
    // incident id, which this write does not touch). The claim still
    // runs in the same synchronous stretch right after the write, so
    // submission order to TextBee continues to match the order the
    // status changes were persisted.
    const statusChanged = incident.status !== status;
    const statusSms =
      statusChanged && status === 'Resolved'
        ? await buildStatusSms(incident, status)
        : null;

    const updated = await incidentService.updateStatus(id, status);

    // incidentService.updateStatus() persists resolvedAt on Resolved, so
    // the re-read record below normally already carries it. The fallback
    // only covers the (defensive) case where it somehow didn't — it must
    // never OVERWRITE the stored timestamp, or the response would disagree
    // with every subsequent GET.
    if (status === 'Resolved' && !updated.resolvedAt) {
      updated.resolvedAt = new Date().toISOString();
    }

    if (statusChanged && smsQueue.claimAnnouncement(id, status)) {
      // Fire-and-forget: enqueue never rejects, so the 200 returns
      // without waiting on TextBee. Only the citizen's registered phone
      // is ever texted, and only for the resolution.
      if (status === 'Resolved') {
        smsQueue.enqueue(id, () =>
          textbeeService.sendSms(updated.citizenPhone, statusSms)
        );
      } else {
        console.info(
          `incidentController: no SMS for intermediate status "${status}" on ${id} (start/end-only policy).`
        );
      }
    } else {
      console.info(
        `incidentController: SMS for status "${status}" skipped on ${id} — status unchanged or already announced.`
      );
    }

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
