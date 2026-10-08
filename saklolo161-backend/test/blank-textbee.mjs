/**
 * test/blank-textbee.mjs
 * --------------------------------------------------------------
 * Imported FIRST by contract.test.mjs so process.env is mutated
 * before config/env.js runs `dotenv.config()`. Blanking
 * TEXTBEE_API_KEY forces sendSms() into its "skipped: API key not
 * configured" path for every app-level test (incident creation,
 * dispatch, status updates), so the suite can NEVER send a real SMS
 * — even on a machine whose .env holds a live key. dotenv does not
 * overwrite an already-defined key, so '' wins over .env.
 * --------------------------------------------------------------
 */

process.env.TEXTBEE_API_KEY = '';
process.env.TEXTBEE_DEVICE_ID = '';
