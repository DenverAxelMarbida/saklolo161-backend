/**
 * services/incidentService.js
 * --------------------------------------------------------------
 * Abstraction layer over "where incident data lives". Controllers
 * NEVER import data/mockIncidents.js directly — they only call the
 * functions exported here. Mirrors the getDb() branching pattern in
 * services/stationService.js so the Phase 3 Firebase swap stays a
 * contained change.
 *
 * PHASE 2 (current): config/firebase.js's initializeFirebase() is
 * still running in mock mode, so getDb() returns null below, and
 * every function here falls through to data/mockIncidents.js.
 *
 * PHASE 3 (once Firebase is live): getDb() returns the RTDB handle
 * and the Firebase branches below take over — incident data is
 * stored under db.ref('incidents').
 * --------------------------------------------------------------
 */

const mockIncidents = require('../data/mockIncidents');

// Live lookup (same shape as services/userService.js) — never
// destructure getDb at load time, so tests can substitute the
// Firebase handle through the shared require-cache instance.
function getDb() {
  return require('../config/firebase').getDb();
}

/**
 * Normalizes an incident to the contract shape. For the mock branch
 * this mutates the stored object IN PLACE (and returns the same
 * reference) so controllers that mutate the returned record — e.g.
 * dispatchController attaching `dispatch`/`station` — keep their
 * changes in the store. Firebase reads are already plain objects.
 * @param {Object|undefined} incident
 * @returns {Object|undefined}
 */
function ensureShape(incident) {
  if (!incident) return incident;
  if (!Array.isArray(incident.evidence)) incident.evidence = [];
  if (typeof incident.evidenceUploading !== 'boolean') incident.evidenceUploading = false;
  if (!Number.isInteger(incident.evidenceExpectedCount) || incident.evidenceExpectedCount < 0) {
    incident.evidenceExpectedCount = 0;
  }
  if (!Number.isInteger(incident.evidenceFailedCount) || incident.evidenceFailedCount < 0) {
    incident.evidenceFailedCount = 0;
  }
  if (!Number.isInteger(incident.evidenceAttempt) || incident.evidenceAttempt < 0) {
    incident.evidenceAttempt = 0;
  }
  if (!Number.isInteger(incident.evidenceAttemptsTotal) || incident.evidenceAttemptsTotal < 0) {
    incident.evidenceAttemptsTotal = 0;
  }
  return incident;
}

/**
 * Returns all incidents.
 * @returns {Promise<Array>}
 */
async function getAll() {
  const db = getDb();

  if (db) {
    // ---- PHASE 3: real Firebase Realtime Database read ----
    const snapshot = await db.ref('incidents').once('value');
    return Object.values(snapshot.val() || {}).map(ensureShape);
  }

  // ---- PHASE 2: in-memory mock fallback ----
  return mockIncidents.getAll().map(ensureShape);
}

/**
 * Stores a new incident.
 * @param {Object} incident
 * @returns {Promise<Object>}
 */
async function add(incident) {
  const db = getDb();
  const shaped = ensureShape(incident);

  if (db) {
    // ---- PHASE 3: real Firebase Realtime Database write ----
    await db.ref(`incidents/${shaped.incidentId}`).set(shaped);
  } else {
    // ---- PHASE 2: in-memory mock fallback ----
    mockIncidents.add(shaped);
  }

  return shaped;
}

/**
 * Finds a single incident by its id (e.g. "INC-20250812-0004").
 * Returns undefined when not found.
 * @param {string} id
 * @returns {Promise<Object|undefined>}
 */
async function findById(id) {
  const db = getDb();

  if (db) {
    // ---- PHASE 3: real Firebase Realtime Database read ----
    const snapshot = await db.ref(`incidents/${id}`).once('value');
    return snapshot.exists() ? ensureShape(snapshot.val()) : undefined;
  }

  // ---- PHASE 2: in-memory mock fallback ----
  return ensureShape(mockIncidents.findById(id));
}

/**
 * Sets an incident's status. Returns the updated incident, or
 * undefined when the incident does not exist.
 *
 * Resolving also PERSISTS `resolvedAt` (server ISO timestamp) on the
 * incident itself. The old flow stamped it on the controller's response
 * object only, so the store never kept it and every later read — web
 * Resolved Log (GET list) and mobile History (GET :id) — returned the
 * incident without a resolution time (the web rendered "N/A").
 * @param {string} id
 * @param {string} status
 * @returns {Promise<Object|undefined>} updated incident, or undefined if missing
 */
async function updateStatus(id, status) {
  const patch = { status };
  if (status === 'Resolved') {
    patch.resolvedAt = new Date().toISOString();
  }
  const db = getDb();

  if (db) {
    // ---- PHASE 3: real Firebase Realtime Database write ----
    await db.ref(`incidents/${id}`).update(patch);
    return findById(id);
  }

  // ---- PHASE 2: in-memory mock fallback ----
  const incident = ensureShape(mockIncidents.updateStatus(id, status));
  if (incident && patch.resolvedAt !== undefined) {
    // The mock store returns its own stored reference, so this mutation
    // persists in place (same aliasing attachDispatch relies on).
    incident.resolvedAt = patch.resolvedAt;
  }
  return incident;
}

/**
 * Attaches the dispatch blocks (`dispatch`, `station`) to an
 * incident and returns the persisted record.
 *
 * The old flow mutated the object returned by updateStatus() and
 * relied on the mock store's reference aliasing to keep those
 * changes — RTDB reads are plain objects, so that mutation never
 * reached Firebase. This method does an explicit read-modify-write
 * on `incidents/{id}` instead, then re-reads so the caller gets
 * exactly what a later findById() will return.
 *
 * @param {string} id incident id
 * @param {Object} patch contract: { dispatch?, station? }
 * @returns {Promise<Object|undefined>} updated incident, or undefined if missing
 */
async function attachDispatch(id, patch) {
  const db = getDb();

  if (db) {
    // ---- PHASE 3: real Firebase Realtime Database write ----
    await db.ref(`incidents/${id}`).update(patch);
    return findById(id);
  }

  // ---- PHASE 2: in-memory mock fallback (mutate in place, as before) ----
  const incident = ensureShape(mockIncidents.findById(id));
  if (!incident) return undefined;
  Object.assign(incident, patch);
  return incident;
}

/**
 * Appends an evidence record to an incident's `evidence[]`.
 * Returns the updated incident, or undefined when the incident does
 * not exist.
 * @param {string} id
 * @param {Object} evidence contract: { fileId, url, mimeType, sizeKb, uploadedAt }
 * @returns {Promise<Object|undefined>}
 */
async function addEvidence(id, evidence) {
  const db = getDb();

  if (db) {
    // ---- PHASE 3 (cutover): read-modify-write onto the RTDB node ----
    const snapshot = await db.ref(`incidents/${id}/evidence`).once('value');
    const current = Array.isArray(snapshot.val()) ? snapshot.val() : [];
    await db.ref(`incidents/${id}/evidence`).set([...current, evidence]);
    return findById(id);
  }

  // ---- PHASE 2: in-memory mock fallback ----
  const incident = ensureShape(mockIncidents.findById(id));
  if (!incident) return undefined;
  incident.evidence.push(evidence);
  return incident;
}

/**
 * Updates the evidence-upload progress fields on an incident. The
 * mobile client signals when its background attachment loop starts
 * (uploading) and finishes (failed count) so the web dashboard can
 * tell dispatchers evidence is still inbound.
 * @param {string} id
 * @param {Object} patch contract: { evidenceUploading?, evidenceExpectedCount?, evidenceFailedCount? }
 * @returns {Promise<Object|undefined>} updated incident, or undefined when missing
 */
async function updateEvidenceStatus(id, patch) {
  const db = getDb();

  if (db) {
    // ---- PHASE 3 (cutover): read-modify-write onto the RTDB node ----
    const snapshot = await db.ref(`incidents/${id}`).once('value');
    const current = snapshot.val();
    if (!current) return undefined;
    await db.ref(`incidents/${id}`).update(patch);
    return findById(id);
  }

  // ---- PHASE 2: in-memory mock fallback ----
  const incident = ensureShape(mockIncidents.findById(id));
  if (!incident) return undefined;
  Object.assign(incident, patch);
  return ensureShape(incident);
}

module.exports = { getAll, add, findById, updateStatus, attachDispatch, addEvidence, updateEvidenceStatus };