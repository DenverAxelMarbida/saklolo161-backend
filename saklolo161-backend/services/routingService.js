/**
 * services/routingService.js
 * --------------------------------------------------------------
 * Straight-line + real driving route calculation.
 *
 *   getRoute(fromLat, fromLng, toLat, toLng)
 *
 * When MAPBOX_ACCESS_TOKEN is set, returns a real driving route from
 * the Mapbox Directions API. On ANY failure (missing token, network,
 * empty result) it degrades to a straight-line fallback — same
 * response shape, straight segment + haversine distance at ~40 km/h
 * (~11.11 m/s) — so the endpoint never errors out on the client.
 *
 * Response shape (contract):
 *   {
 *     geometry: { type: 'LineString', coordinates: [[lng, lat], ...] },
 *     distanceMeters: number,
 *     durationSeconds: number,
 *   }
 * --------------------------------------------------------------
 */

const axios = require('axios');
const { MAPBOX_ACCESS_TOKEN } = require('../config/env');

const FALLBACK_SPEED_MPS = 100000 / 9000; // ~11.11 m/s ≈ 40 km/h

// Tiny per-process route cache keyed by 4-decimal-rounded coords.
// Mapbox Directions is the slowest public call this backend makes;
// caching means the dashboard's repeated tracker/poll reads resolve
// instantly instead of re-hitting the Directions API every time.
// Fallback (straight-line) results are cached too, so a Mapbox outage
// is never re-awaited on subsequent same-pair requests.
const ROUTE_CACHE_TTL_MS = 30 * 60 * 1000;
const routeCache = new Map();

function cacheKey(fromLat, fromLng, toLat, toLng) {
  return [
    fromLat.toFixed(4),
    fromLng.toFixed(4),
    toLat.toFixed(4),
    toLng.toFixed(4),
  ].join('|');
}

function cacheGet(key) {
  const hit = routeCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.cachedAt > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  // Bound the cache so long-running dev servers don't grow without limit.
  if (routeCache.size >= 500) {
    const oldest = routeCache.keys().next().value;
    routeCache.delete(oldest);
  }
  routeCache.set(key, { value, cachedAt: Date.now() });
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/lng points in meters.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Builds the guaranteed-response route (Mapbox when available,
 * straight-line otherwise).
 * @param {number} fromLat
 * @param {number} fromLng
 * @param {number} toLat
 * @param {number} toLng
 * @returns {Promise<{geometry: Object, distanceMeters: number, durationSeconds: number}>}
 */
async function getRoute(fromLat, fromLng, toLat, toLng) {
  const key = cacheKey(fromLat, fromLng, toLat, toLng);
  const cached = cacheGet(key);
  if (cached) return cached;

  let result;
  if (MAPBOX_ACCESS_TOKEN) {
    try {
      const res = await axios.get(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}`,
        {
          params: {
            alternatives: 'false',
            geometries: 'geojson',
            overview: 'full',
            steps: 'false',
            access_token: MAPBOX_ACCESS_TOKEN,
          },
          timeout: 8000,
        }
      );

      const route = res.data && res.data.routes && res.data.routes[0];
      const geometry =
        route && route.geometry && route.geometry.type === 'LineString'
          ? route.geometry
          : null;

      if (route && geometry && typeof route.distance === 'number') {
        result = {
          geometry,
          distanceMeters: Math.round(route.distance),
          durationSeconds: Math.round(route.duration),
        };
      } else {
        console.error('routingService: Mapbox returned no usable route, using straight-line fallback');
      }
    } catch (apiError) {
      console.error('routingService: Mapbox Directions failed, using straight-line fallback:', apiError.message);
    }
  } else {
    console.error('routingService: no MAPBOX_ACCESS_TOKEN set, using straight-line fallback');
  }

  if (!result) {
    // ---- Straight-line fallback (contract-shaped) ----
    const distanceMeters = haversineMeters(fromLat, fromLng, toLat, toLng);
    result = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [fromLng, fromLat],
          [toLng, toLat],
        ],
      },
      distanceMeters: Math.round(distanceMeters),
      durationSeconds: Math.round(distanceMeters / FALLBACK_SPEED_MPS),
    };
  }

  cacheSet(key, result);
  return result;
}

module.exports = { getRoute, haversineMeters };