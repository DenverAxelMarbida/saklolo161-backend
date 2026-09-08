/**
 * test/blank-mapbox.mjs
 * --------------------------------------------------------------
 * Imported FIRST by contract.test.mjs so process.env is mutated
 * before config/env.js runs `dotenv.config()`. Blanking the Mapbox
 * token makes /api/routes take the deterministic straight-line
 * fallback in CI (live Mapbox behavior is smoke-tested separately).
 * --------------------------------------------------------------
 */

process.env.MAPBOX_ACCESS_TOKEN = '';