/**
 * controllers/dispatchController.js
 * --------------------------------------------------------------
 * Handles POST /api/incidents/dispatch — a dispatcher assigning a
 * specific station + unit to a pending incident.
 *
 * Station lookups go through services/stationService.js (never
 * config/stations.js directly) so this file requires ZERO changes
 * when Phase 3 swaps station storage over to Firebase.
 * --------------------------------------------------------------
 */

const mockIncidents = require('../data/mockIncidents');
const stationService = require('../services/stationService');
const semaphoreService = require('../services/semaphoreService');

/**
 * POST /api/incidents/dispatch
 * Body: { incidentId, stationId, assignedUnit }
 *
 * Flow:
 *   1. Validate the payload shape.
 *   2. Confirm the incident exists and isn't already Resolved.
 *   3. Confirm the station exists and matches the incident's category.
 *   4. Confirm the unit actually belongs to that station.
 *   5. Update the incident's status + attach dispatch details.
 *   6. Fire SMS alerts to both the station and the citizen.
 */
async function dispatchIncident(req, res, next) {
  try {
    const { incidentId, stationId, assignedUnit } = req.body;

    // ---- 1. Basic payload validation ----
    const errors = [];
    if (!incidentId || typeof incidentId !== 'string') {
      errors.push('incidentId is required and must be a string.');
    }
    if (!stationId || typeof stationId !== 'string') {
      errors.push('stationId is required and must be a string.');
    }
    if (!assignedUnit || typeof assignedUnit !== 'string') {
      errors.push('assignedUnit is required and must be a string.');
    }
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors });
    }

    // ---- 2. Look up the incident ----
    const incident = mockIncidents.findById(incidentId);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident ${incidentId} not found.`,
      });
    }
    if (incident.status === 'Resolved') {
      return res.status(400).json({
        success: false,
        message: `Incident ${incidentId} is already Resolved and cannot be dispatched.`,
      });
    }

    // ---- 3. Look up the station (async — Phase 3-ready) ----
    const station = await stationService.getStationById(stationId);
    if (!station) {
      return res.status(404).json({
        success: false,
        message: `Station ${stationId} not found.`,
      });
    }
    if (station.category !== incident.category) {
      return res.status(400).json({
        success: false,
        message: `${station.name} handles ${station.category} incidents, not ${incident.category}.`,
      });
    }

    // ---- 4. Confirm the unit belongs to that station ----
    if (!station.assignedUnits.includes(assignedUnit)) {
      return res.status(400).json({
        success: false,
        message: `"${assignedUnit}" is not a registered unit of ${station.name}.`,
        availableUnits: station.assignedUnits,
      });
    }

    // ---- 5. Update the incident record ----
    const updated = mockIncidents.updateStatus(incidentId, 'Dispatched');
    updated.dispatch = {
      stationId: station.id,
      stationName: station.name,
      assignedUnit,
      estimatedTurnout: station.estimatedTurnout,
      dispatchedAt: new Date().toISOString(),
    };

    // ---- 6. Notify station + citizen (mocked via semaphoreService in Phase 1/2) ----
    await notifyStation(station, updated, assignedUnit);
    await notifyCitizen(updated, station, assignedUnit);

    return res.status(200).json({
      success: true,
      message: `Incident ${incidentId} dispatched to ${station.name} (${assignedUnit}).`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Sends a dispatch alert SMS to the responding station's duty phone.
 */
async function notifyStation(station, incident, assignedUnit) {
  const message = `Saklolo 161 DISPATCH: ${incident.category} incident ${incident.incidentId} at ${incident.location.address}. Unit assigned: ${assignedUnit}.`;
  return semaphoreService.sendSms(station.phone, message);
}

/**
 * Notifies the citizen that a unit has been dispatched to their location.
 */
async function notifyCitizen(incident, station, assignedUnit) {
  const message = `Saklolo 161: ${station.name} has dispatched ${assignedUnit} to your location. ETA: ${station.estimatedTurnout}.`;
  return semaphoreService.sendSms(incident.citizenPhone, message);
}

module.exports = { dispatchIncident };
