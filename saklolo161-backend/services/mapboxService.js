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
  const response = await fetch(url);
  const data = await response.json();
  return data.features?.[0]?.place_name || 'Unknown location';
}

module.exports = { reverseGeocode };
