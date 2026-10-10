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

const incidentService = require('../services/incidentService');
const stationService = require('../services/stationService');
const { getRoute } = require('../services/routingService');

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
 *
 * SMS policy (start/end only): dispatch sends NO text messages — not
 * to the station, not to the citizen. The citizen already received a
 * report confirmation at creation and will receive a resolution text
 * when the incident is resolved. Station contact stays voice-call.
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
    const incident = await incidentService.findById(incidentId);
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

    // ---- 3b. Inactive stations cannot accept dispatches (soft-deleted
    // records stay in the store for history but leave every dropdown).
    if (!stationService.isStationActive(station)) {
      return res.status(400).json({
        success: false,
        message: `${station.name} is currently inactive and cannot accept dispatches.`,
      });
    }

    // ---- 3c. Agency authorization check (verifyAuth set req.user) ----
    if (
      req.user.agency !== 'ALL' &&
      req.user.agency.toLowerCase() !== incident.category.toLowerCase()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Your agency is not authorized to dispatch this incident.',
      });
    }

    // ---- 4. Confirm the unit belongs to that station (matched by
    // unit id OR display name for backward compatibility with the
    // legacy string-unit records) and is currently active. ----
    const matchedUnit = stationService.findUnitInStation(station, assignedUnit);
    if (!matchedUnit) {
      return res.status(400).json({
        success: false,
        message: `"${assignedUnit}" is not a registered unit of ${station.name}.`,
        availableUnits: stationService.getActiveUnitNames(station),
      });
    }
    if (matchedUnit.isActive === false) {
      return res.status(400).json({
        success: false,
        message: `"${matchedUnit.name}" is currently inactive and cannot accept dispatches.`,
        availableUnits: stationService.getActiveUnitNames(station),
      });
    }

    // ---- 5. Update the incident record ----
    await incidentService.updateStatus(incidentId, 'Dispatched');

    // Compute a real driving ETA from the same routing service the web
    // dashboard and mobile tracker use (never the station's canned
    // readiness string, which can be wildly short when a unit is
    // dispatched across town) and persist the dispatch/station blocks.
    const arrivalEtaMinutes = await computeArrivalEta(station, incident.location);

    const dispatchBlock = {
      stationId: station.id,
      stationName: station.name,
      assignedUnit,
      estimatedTurnout: station.estimatedTurnout,
      dispatchedAt: new Date().toISOString(),
    };
    if (arrivalEtaMinutes) dispatchBlock.arrivalEtaMinutes = arrivalEtaMinutes;

    // Contract anchor: the responding station is exposed at the TOP
    // level (`incident.station.coords`), not nested under dispatch.
    const stationBlock = {
      id: station.id,
      name: station.name,
      coords: station.coords || null,
    };

    // Persist both blocks via the service (mutating the returned
    // record directly only lands in the mock store — RTDB re-reads
    // are plain objects). Returns the persisted incident.
    const updated = await incidentService.attachDispatch(incidentId, {
      dispatch: dispatchBlock,
      station: stationBlock,
    });

    // No SMS here by design (start/end-only policy): neither the
    // station nor the citizen is texted on dispatch. Station contact
    // stays voice-call; the citizen's next text is the resolution SMS.

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
 * Computes a real arrival ETA (whole minutes, clamped to >= 1) via the
 * same routing service the web dashboard uses. Returns null when either
 * endpoint lacks coordinates or the routing call fails — a dispatch must
 * never fail over an ETA computation; the response then simply omits
 * arrivalEtaMinutes.
 */
async function computeArrivalEta(station, location) {
  const c = station && station.coords;
  if (
    !c ||
    typeof c.lat !== 'number' ||
    typeof c.lng !== 'number' ||
    !location ||
    typeof location.latitude !== 'number' ||
    typeof location.longitude !== 'number'
  ) {
    return null;
  }
  try {
    const route = await getRoute(c.lat, c.lng, location.latitude, location.longitude);
    return Math.max(1, Math.round(route.durationSeconds / 60));
  } catch (error) {
    console.error('dispatchController: ETA computation failed:', error.message);
    return null;
  }
}

module.exports = { dispatchIncident };
