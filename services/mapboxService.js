/**
 * services/mapboxService.js
 * --------------------------------------------------------------
 * Wraps all logic that talks to the Mapbox Geocoding API.
 *
 * PHASE 1 (current): reverseGeocode() returns a MOCKED address so
 * the rest of the team isn't blocked waiting on a Mapbox token.
 *
 * PHASE 2 (Mobile GPS/Mapbox developer): replace the mock block
 * with a real fetch() call to the Mapbox Reverse Geocoding endpoint:
 *   GET https://api.mapbox.com/geocoding/v5/mapbox.places/{lng},{lat}.json
 * --------------------------------------------------------------
 */

const { MAPBOX_ACCESS_TOKEN } = require('../config/env');

// A small pool of realistic Marikina City barangay addresses used
// to simulate varied reverse-geocoding results in mock mode.
const MOCK_ADDRESSES = [
  'Brgy. Tumana, Marikina City',
  'Brgy. Malanday, Marikina City',
  'Brgy. Concepcion Uno, Marikina City',
  'Brgy. Nangka, Marikina City',
  'Brgy. Sto. Niño, Marikina City',
  'Brgy. Marikina Heights, Marikina City',
];

/**
 * Reverse-geocodes a lat/lng pair into a human-readable address.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<string>} address string
 */
async function reverseGeocode(latitude, longitude) {
  // ---- REAL MAPBOX CALL (uncomment for Phase 2) ---------------------
  //
  // const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_ACCESS_TOKEN}`;
  // const response = await fetch(url);
  // const data = await response.json();
  // return data.features?.[0]?.place_name || 'Unknown location';
  // ---------------------------------------------------------------------

  // ---- MOCK MODE (Phase 1) --------------------------------------------
  // Deterministically pick an address so repeated calls with the
  // same coordinates return the same barangay (a bit more realistic
  // than fully random results for UI testing/screenshots).
  const index = Math.floor((latitude + longitude) * 1000) % MOCK_ADDRESSES.length;
  const safeIndex = Math.abs(index);
  return MOCK_ADDRESSES[safeIndex] || 'Brgy. Tumana, Marikina City';
}

module.exports = { reverseGeocode };
