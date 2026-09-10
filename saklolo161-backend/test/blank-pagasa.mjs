/**
 * test/blank-pagasa.mjs
 * --------------------------------------------------------------
 * Imported FIRST by contract.test.mjs so process.env is mutated
 * before config/env.js runs `dotenv.config()`. Pointing the PAGASA
 * feed at a dead local port makes /api/weather-river fail fast
 * (ECONNREFUSED, not an 8s timeout) and deterministically degrade
 * to `source: "mock"` in CI — live feed behavior is verified
 * separately. Without this, the default 5s vitest timeout trips in
 * suites that cannot reach DOST-PAGASA.
 * --------------------------------------------------------------
 */

process.env.PAGASA_RIVER_ENDPOINT = 'http://127.0.0.1:9/';