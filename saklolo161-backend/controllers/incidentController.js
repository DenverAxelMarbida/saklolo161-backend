/**
 * controllers/incidentController.js
 * --------------------------------------------------------------
 * Handles the business logic for incident-related requests.
 * Talks to /data/mockIncidents.js (Phase 1) and /services (Mapbox,
 * Semaphore) — routes stay thin and just point here.
 * --------------------------------------------------------------
 */

const mockIncidents = require('../data/mockIncidents');
const mapboxService = require('../services/mapboxService');
const semaphoreService = require('../services/semaphoreService');

const VALID_STATUSES = ['Pending', 'Dispatched', 'En Route', 'Resolved'];

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
    };

    mockIncidents.add(newIncident);

    // Fire-and-forget confirmation SMS to the citizen (mocked in Phase 1).
    semaphoreService.sendSms(
      citizenPhone,
      `Saklolo 161: Your ${category} report (${newIncident.incidentId}) has been received. Help is on the way.`
    );

    return res.status(201).json({
      success: true,
      message: 'Incident created successfully.',
      data: newIncident,
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
function getIncidents(req, res, next) {
  try {
    const incidents = mockIncidents.getAll();

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
      data: filtered,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/incidents/:id
 * Returns a single incident by ID. Useful for detail screens.
 */
function getIncidentById(req, res, next) {
  try {
    const { id } = req.params;
    const incident = mockIncidents.findById(id);

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident ${id} not found.`,
      });
    }

    return res.status(200).json({ success: true, data: incident });
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

    const incident = mockIncidents.findById(id);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident ${id} not found.`,
      });
    }

    const updated = mockIncidents.updateStatus(id, status);

    // Notify the citizen of the status change (mocked in Phase 1).
    await semaphoreService.sendSms(
      updated.citizenPhone,
      `Saklolo 161: Your incident ${updated.incidentId} status is now "${status}".`
    );

    return res.status(200).json({
      success: true,
      message: `Incident ${id} status updated to "${status}".`,
      data: updated,
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
};
