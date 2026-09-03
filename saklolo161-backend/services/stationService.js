/**
 * services/stationService.js
 * --------------------------------------------------------------
 * Abstraction layer over "where station data lives". Controllers
 * NEVER import config/stations.js directly — they only call the
 * functions exported here. That's what makes the Phase 3 Firebase
 * migration a one-file change.
 *
 * PHASE 2 (current): config/firebase.js's initializeFirebase() is
 * still running in mock mode, so getDb() returns null below, and
 * every function here falls through to the static config/stations.js
 * array.
 *
 * PHASE 3 (once Firebase is live):
 *   1. Uncomment the real initialization block in config/firebase.js
 *      and set FIREBASE_CREDENTIALS + FIREBASE_DATABASE_URL in .env
 *      (or Render's environment settings).
 *   2. Seed the `/stations` node in Firebase RTDB using the entries
 *      in config/stations.js as your source data.
 *   3. That's it — getDb() will start returning a real database
 *      handle, and the functions below automatically take the
 *      Firebase branch instead of the config fallback. No changes
 *      needed in dispatchController.js or any route file.
 * --------------------------------------------------------------
 */

const stations = require('../config/stations');
const { getDb } = require('../config/firebase');

/**
 * Returns all station profiles.
 * @returns {Promise<Array>}
 */
async function getAllStations() {
  const db = getDb();

  if (db) {
    // ---- PHASE 3: real Firebase Realtime Database read ----
    const snapshot = await db.ref('stations').once('value');
    return Object.values(snapshot.val() || {});
  }

  // ---- PHASE 2: static config/stations.js fallback ----
  return stations;
}

/**
 * Finds a single station by its id (e.g. "FIRE_BFP_STATION_2").
 * @param {string} stationId
 * @returns {Promise<Object|undefined>}
 */
async function getStationById(stationId) {
  const db = getDb();

  if (db) {
    // ---- PHASE 3: real Firebase Realtime Database read ----
    const snapshot = await db.ref(`stations/${stationId}`).once('value');
    return snapshot.exists() ? snapshot.val() : undefined;
  }

  // ---- PHASE 2: static config/stations.js fallback ----
  return stations.find((s) => s.id === stationId);
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

module.exports = { getAllStations, getStationById, getStationsByCategory };
