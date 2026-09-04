/**
 * services/mapboxService.js
 * --------------------------------------------------------------
 * Wraps all logic that talks to the Mapbox Geocoding API.
 * --------------------------------------------------------------
 */

const { MAPBOX_ACCESS_TOKEN } = require('../config/env');

/**
 * Reverse-geocodes a lat/lng pair into a human-readable address
 * using the Mapbox Geocoding API.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<string>} address string
 */
async function reverseGeocode(latitude, longitude) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_ACCESS_TOKEN}`;

  // A geocoding failure must never block or crash incident creation — the
  // caller stores whatever string we return. Log the real cause (missing/
  // invalid token, network error, rate limit) so it's diagnosable in the
  // server logs instead of surfacing as a silent "Unknown location".
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.error('Mapbox reverse-geocode network error:', error.message);
    return 'Unknown location';
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.features?.length) {
    console.error(
      'Mapbox reverse-geocode failed:',
      response.status,
      data.message || 'no features returned'
    );
    return 'Unknown location';
  }

  return data.features[0].place_name;
}

module.exports = { reverseGeocode };
