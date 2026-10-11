/**
 * services/stationService.js
 * --------------------------------------------------------------
 * Abstraction layer over "where station data lives". Controllers
 * NEVER import config/stations.js directly — they only call the
 * functions exported here.
 *
 * READ path: Firebase Realtime Database (`/stations` node, keyed by
 * station id) is the source of truth. When Firebase is unavailable
 * (getDb() throws because initializeFirebase() never succeeded),
 * reads fall back to the static config/stations.js array so dispatch
 * keeps working in a degraded mode.
 *
 * WRITE path (station/unit management): Firebase is REQUIRED. When
 * it is unavailable the write throws a StationError with
 * statusCode 503 — writes are NEVER reported as successful unless
 * they reached Firebase. Nothing is ever saved only in memory or
 * only to the static array.
 *
 * LEGACY COMPATIBILITY (reads only): records seeded by
 * scripts/seedStations.js (or written before this feature) look like
 *   { id, name, category, phone, coords, assignedUnits: ["Unit A"],
 *     estimatedTurnout }
 * with NO `isActive` field and string units. The compatibility rule
 * is: a missing `isActive` means ACTIVE, and a string unit means an
 * active unit whose id and name are both that string. Valid existing
 * stations/units therefore stay dispatchable after migration, and
 * management writes normalize them to the object form going forward.
 *
 * Canonical station shape (writes):
 *   { id, name, category, phone, coords: { lat, lng },
 *     estimatedTurnout, isActive,
 *     assignedUnits: [{ id, name, isActive }] }
 * --------------------------------------------------------------
 */

const stations = require('../config/stations');

// Live lookup (same shape as services/userService.js) — never
// destructure getDb at load time, so tests can substitute the
// Firebase handle through the shared require-cache instance.
function getDb() {
  return require('../config/firebase').getDb();
}

const VALID_CATEGORIES = ['Medical', 'Fire', 'Flood', 'Crime'];

const STATION_ID_PATTERN = /^[A-Z0-9_]{3,64}$/;
const PHONE_PATTERN = /^[\d\s()+.\-/#]*$/;

/**
 * Error type for station-store failures. Controllers map
 * `statusCode` to the HTTP response; Firebase internals are never
 * attached to the message sent to clients.
 */
class StationError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'StationError';
    this.statusCode = statusCode;
  }
}

/**
 * Returns the Firebase handle, or null when Firebase was never
 * initialized — WITHOUT throwing. Callers decide: reads fall back
 * to the static config, writes throw StationError(503).
 */
function safeGetDb() {
  try {
    return getDb();
  } catch (err) {
    return null;
  }
}

/**
 * Returns the Firebase handle for a write, or throws StationError
 * 503 when Firebase is unavailable. This is what guarantees a failed
 * write is never reported as successful.
 */
function requireDb() {
  const db = safeGetDb();
  if (!db) {
    throw new StationError(
      503,
      'Station store is unavailable. Changes were NOT saved — try again later.'
    );
  }
  return db;
}

// ---- Normalization (legacy compatibility) -------------------------------

/**
 * Normalizes one assigned unit to { id, name, isActive }.
 * Legacy string units ("Rescue Boat Unit #1") become active units
 * whose id and name are both that string. Object units missing
 * `isActive` default to active.
 */
function normalizeUnit(unit) {
  if (typeof unit === 'string') {
    return { id: unit, name: unit, isActive: true };
  }
  if (unit && typeof unit === 'object') {
    return {
      id: unit.id,
      name: unit.name,
      isActive: unit.isActive !== false,
    };
  }
  return null;
}

function normalizeUnits(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  return list.map(normalizeUnit).filter((u) => u && typeof u.id === 'string' && u.id !== '' && typeof u.name === 'string' && u.name !== '');
}

/**
 * Normalizes a raw station record to the canonical shape. A missing
 * `isActive` means ACTIVE (legacy seeded records stay usable).
 */
function normalizeStation(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    phone: raw.phone ?? '',
    coords: raw.coords ?? null,
    estimatedTurnout: raw.estimatedTurnout ?? '',
    isActive: raw.isActive !== false,
    assignedUnits: normalizeUnits(raw.assignedUnits),
  };
}

function isStationActive(station) {
  return !!station && station.isActive !== false;
}

/**
 * Finds a unit inside a (normalized or raw) station by id OR name.
 * @returns {Object|undefined} normalized { id, name, isActive }
 */
function findUnitInStation(station, ref) {
  if (!station || typeof ref !== 'string') return undefined;
  return normalizeUnits(station.assignedUnits).find((u) => u.id === ref || u.name === ref);
}

/**
 * Display names of a station's ACTIVE units (backward-compatible
 * string list for dispatch error payloads).
 */
function getActiveUnitNames(station) {
  return normalizeUnits(station && station.assignedUnits)
    .filter((u) => u.isActive !== false)
    .map((u) => u.name);
}

// ---- Validation ----------------------------------------------------------

function validateCoords(coords, { required }) {
  const errors = [];
  if (coords === undefined || coords === null) {
    if (required) errors.push('coords is required ({ lat, lng }).');
    return errors;
  }
  if (typeof coords !== 'object' || Array.isArray(coords)) {
    errors.push('coords must be an object { lat, lng }.');
    return errors;
  }
  if (typeof coords.lat !== 'number' || Number.isNaN(coords.lat) || coords.lat < -90 || coords.lat > 90) {
    errors.push('coords.lat must be a number between -90 and 90.');
  }
  if (typeof coords.lng !== 'number' || Number.isNaN(coords.lng) || coords.lng < -180 || coords.lng > 180) {
    errors.push('coords.lng must be a number between -180 and 180.');
  }
  return errors;
}

function validatePhone(phone, { required }) {
  const errors = [];
  if (phone === undefined || phone === null || phone === '') {
    if (required) errors.push('phone is required.');
    return errors;
  }
  if (typeof phone !== 'string') {
    errors.push('phone must be a string.');
    return errors;
  }
  if (phone.length > 32) {
    errors.push('phone must be at most 32 characters.');
  } else if (!PHONE_PATTERN.test(phone)) {
    errors.push('phone contains invalid characters.');
  }
  return errors;
}

/**
 * Validates a station payload. `isCreate=true` requires id + the
 * mandatory fields; updates validate only the fields present.
 * @returns {string[]} error messages (empty when valid)
 */
function validateStationPayload(payload, { isCreate }) {
  const errors = [];
  const body = payload && typeof payload === 'object' ? payload : {};

  if (isCreate) {
    if (!body.id || typeof body.id !== 'string' || !STATION_ID_PATTERN.test(body.id)) {
      errors.push('id is required (3-64 chars: A-Z, 0-9, underscore).');
    }
  } else if (body.id !== undefined) {
    errors.push('Station id cannot be changed.');
  }

  if (isCreate || body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push('name is required and must be a non-empty string.');
    } else if (body.name.trim().length > 120) {
      errors.push('name must be at most 120 characters.');
    }
  }

  if (isCreate || body.category !== undefined) {
    if (!VALID_CATEGORIES.includes(body.category)) {
      errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}.`);
    }
  }

  if (body.phone !== undefined) {
    errors.push(...validatePhone(body.phone, { required: false }));
  }

  errors.push(...validateCoords(body.coords, { required: false }));

  if (body.estimatedTurnout !== undefined) {
    if (typeof body.estimatedTurnout !== 'string') {
      errors.push('estimatedTurnout must be a string.');
    } else if (body.estimatedTurnout.length > 64) {
      errors.push('estimatedTurnout must be at most 64 characters.');
    }
  }

  if (body.assignedUnits !== undefined) {
    if (!Array.isArray(body.assignedUnits)) {
      errors.push('assignedUnits must be an array of unit names or { id, name } objects.');
    } else {
      const seen = new Set();
      for (const raw of body.assignedUnits) {
        const unit = normalizeUnit(raw);
        if (!unit || typeof unit.name !== 'string' || unit.name.trim() === '') {
          errors.push('Every assigned unit needs a non-empty id/name.');
          break;
        }
        if (seen.has(unit.id)) {
          errors.push(`Duplicate unit id "${unit.id}" in assignedUnits.`);
          break;
        }
        seen.add(unit.id);
      }
    }
  }

  return errors;
}

/**
 * Validates a unit payload for add/update within a station.
 * @returns {string[]} error messages (empty when valid)
 */
function validateUnitPayload(payload, { isCreate }) {
  const errors = [];
  const body = payload && typeof payload === 'object' ? payload : {};

  if (isCreate) {
    if (!body.id || typeof body.id !== 'string' || body.id.trim() === '') {
      errors.push('Unit id is required and must be a non-empty string.');
    } else if (body.id.length > 64) {
      errors.push('Unit id must be at most 64 characters.');
    } else if (/[.#$[\]/]/.test(body.id)) {
      errors.push('Unit id must not contain . # $ [ ] / characters.');
    }
  } else if (body.id !== undefined) {
    errors.push('Unit id cannot be changed.');
  }

  if (isCreate || body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push('Unit name is required and must be a non-empty string.');
    } else if (body.name.trim().length > 120) {
      errors.push('Unit name must be at most 120 characters.');
    }
  }

  return errors;
}

// ---- Reads ---------------------------------------------------------------

/**
 * Returns all station profiles (normalized), Firebase-first with a
 * static-config fallback when Firebase is unavailable.
 * @returns {Promise<Array>}
 */
async function getAllStations() {
  const db = safeGetDb();

  if (db) {
    const snapshot = await db.ref('stations').once('value');
    const val = snapshot.val() || {};
    return Object.values(val).map(normalizeStation);
  }

  // Static fallback (degraded mode — reads only, never writes).
  return stations.map(normalizeStation);
}

/**
 * Finds a single station by its id (normalized), or undefined.
 * @param {string} stationId
 * @returns {Promise<Object|undefined>}
 */
async function getStationById(stationId) {
  const db = safeGetDb();

  if (db) {
    const snapshot = await db.ref(`stations/${stationId}`).once('value');
    return snapshot.exists() ? normalizeStation(snapshot.val()) : undefined;
  }

  return normalizeStation(stations.find((s) => s.id === stationId));
}

/**
 * Finds all stations for a given category (Medical, Fire, Flood, Crime).
 * @param {string} category
 * @returns {Promise<Array>}
 */
async function getStationsByCategory(category) {
  const all = await getAllStations();
  return all.filter((s) => s.category === category);
}

/**
 * Returns only ACTIVE stations (and, per station, only ACTIVE units
 * are NOT stripped here — callers filter units for display; dispatch
 * validation checks status explicitly). Optional category filter.
 */
async function getActiveStations(category) {
  const all = await getAllStations();
  return all.filter(
    (s) => isStationActive(s) && (!category || s.category === category)
  );
}

// ---- Writes (Firebase required — never silently succeed) ------------------

/**
 * Creates a station. Throws 409 when the id already exists.
 */
async function createStation(payload) {
  const errors = validateStationPayload(payload, { isCreate: true });
  if (errors.length > 0) {
    throw new StationError(400, `Validation failed: ${errors.join(' ')}`);
  }

  const db = requireDb();
  const existing = await db.ref(`stations/${payload.id}`).once('value');
  if (existing.exists()) {
    throw new StationError(409, `Station ${payload.id} already exists.`);
  }

  const record = normalizeStation({
    id: payload.id,
    name: payload.name.trim(),
    category: payload.category,
    phone: payload.phone ?? '',
    coords: payload.coords ?? null,
    estimatedTurnout: payload.estimatedTurnout ?? '',
    isActive: payload.isActive !== false,
    assignedUnits: payload.assignedUnits ?? [],
  });

  try {
    await db.ref(`stations/${payload.id}`).set(record);
  } catch (err) {
    if (err instanceof StationError) throw err;
    throw new StationError(503, 'Station store write failed. Changes were NOT saved.');
  }
  return record;
}

/**
 * Updates mutable station details (name, category, phone, coords,
 * estimatedTurnout). Id and assignedUnits/isActive change only via
 * their dedicated operations. Throws 404 when missing.
 */
async function updateStation(stationId, changes) {
  const errors = validateStationPayload(changes, { isCreate: false });
  if (errors.length > 0) {
    throw new StationError(400, `Validation failed: ${errors.join(' ')}`);
  }

  const allowed = ['name', 'category', 'phone', 'coords', 'estimatedTurnout'];
  const patch = {};
  for (const key of allowed) {
    if (changes[key] !== undefined) {
      patch[key] = key === 'name' && typeof changes[key] === 'string' ? changes[key].trim() : changes[key];
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new StationError(400, 'No updatable station fields provided.');
  }

  const db = requireDb();
  const snapshot = await db.ref(`stations/${stationId}`).once('value');
  if (!snapshot.exists()) {
    throw new StationError(404, `Station ${stationId} not found.`);
  }

  try {
    await db.ref(`stations/${stationId}`).update(patch);
  } catch (err) {
    if (err instanceof StationError) throw err;
    throw new StationError(503, 'Station store write failed. Changes were NOT saved.');
  }
  return normalizeStation({ ...snapshot.val(), ...patch });
}

/**
 * Activates or deactivates a station (soft-delete — history kept).
 */
async function setStationActive(stationId, isActive) {
  if (typeof isActive !== 'boolean') {
    throw new StationError(400, 'isActive must be a boolean.');
  }

  const db = requireDb();
  const snapshot = await db.ref(`stations/${stationId}`).once('value');
  if (!snapshot.exists()) {
    throw new StationError(404, `Station ${stationId} not found.`);
  }

  try {
    await db.ref(`stations/${stationId}`).update({ isActive });
  } catch (err) {
    if (err instanceof StationError) throw err;
    throw new StationError(503, 'Station store write failed. Changes were NOT saved.');
  }
  return normalizeStation({ ...snapshot.val(), isActive });
}

/**
 * Adds a unit to a station. Unit ids are unique within the station.
 */
async function addUnit(stationId, payload) {
  const errors = validateUnitPayload(payload, { isCreate: true });
  if (errors.length > 0) {
    throw new StationError(400, `Validation failed: ${errors.join(' ')}`);
  }

  const db = requireDb();
  const snapshot = await db.ref(`stations/${stationId}`).once('value');
  if (!snapshot.exists()) {
    throw new StationError(404, `Station ${stationId} not found.`);
  }

  const current = normalizeUnits(snapshot.val().assignedUnits);
  if (current.some((u) => u.id === payload.id)) {
    throw new StationError(409, `Unit "${payload.id}" already exists in station ${stationId}.`);
  }

  const next = [
    ...current,
    { id: payload.id, name: payload.name.trim(), isActive: payload.isActive !== false },
  ];
  try {
    await db.ref(`stations/${stationId}`).update({ assignedUnits: next });
  } catch (err) {
    if (err instanceof StationError) throw err;
    throw new StationError(503, 'Station store write failed. Changes were NOT saved.');
  }
  return normalizeStation({ ...snapshot.val(), assignedUnits: next });
}

/**
 * Renames a unit (unit id is immutable).
 */
async function updateUnit(stationId, unitId, changes) {
  const errors = validateUnitPayload(changes, { isCreate: false });
  if (errors.length > 0) {
    throw new StationError(400, `Validation failed: ${errors.join(' ')}`);
  }
  if (changes.name === undefined) {
    throw new StationError(400, 'No updatable unit fields provided.');
  }

  const db = requireDb();
  const snapshot = await db.ref(`stations/${stationId}`).once('value');
  if (!snapshot.exists()) {
    throw new StationError(404, `Station ${stationId} not found.`);
  }

  const current = normalizeUnits(snapshot.val().assignedUnits);
  const index = current.findIndex((u) => u.id === unitId);
  if (index === -1) {
    throw new StationError(404, `Unit "${unitId}" not found in station ${stationId}.`);
  }

  const next = current.map((u, i) => (i === index ? { ...u, name: changes.name.trim() } : u));
  try {
    await db.ref(`stations/${stationId}`).update({ assignedUnits: next });
  } catch (err) {
    if (err instanceof StationError) throw err;
    throw new StationError(503, 'Station store write failed. Changes were NOT saved.');
  }
  return normalizeStation({ ...snapshot.val(), assignedUnits: next });
}

/**
 * Activates or deactivates a unit (soft-delete — dispatch history kept).
 */
async function setUnitActive(stationId, unitId, isActive) {
  if (typeof isActive !== 'boolean') {
    throw new StationError(400, 'isActive must be a boolean.');
  }

  const db = requireDb();
  const snapshot = await db.ref(`stations/${stationId}`).once('value');
  if (!snapshot.exists()) {
    throw new StationError(404, `Station ${stationId} not found.`);
  }

  const current = normalizeUnits(snapshot.val().assignedUnits);
  const index = current.findIndex((u) => u.id === unitId);
  if (index === -1) {
    throw new StationError(404, `Unit "${unitId}" not found in station ${stationId}.`);
  }

  const next = current.map((u, i) => (i === index ? { ...u, isActive } : u));
  try {
    await db.ref(`stations/${stationId}`).update({ assignedUnits: next });
  } catch (err) {
    if (err instanceof StationError) throw err;
    throw new StationError(503, 'Station store write failed. Changes were NOT saved.');
  }
  return normalizeStation({ ...snapshot.val(), assignedUnits: next });
}

module.exports = {
  VALID_CATEGORIES,
  StationError,
  normalizeStation,
  normalizeUnit,
  normalizeUnits,
  isStationActive,
  findUnitInStation,
  getActiveUnitNames,
  validateStationPayload,
  validateUnitPayload,
  getAllStations,
  getStationById,
  getStationsByCategory,
  getActiveStations,
  createStation,
  updateStation,
  setStationActive,
  addUnit,
  updateUnit,
  setUnitActive,
};
