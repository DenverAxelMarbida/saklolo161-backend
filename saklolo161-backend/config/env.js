/**
 * config/env.js
 * --------------------------------------------------------------
 * Centralized environment variable loader.
 *
 * Instead of calling `process.env.X` all over the codebase, every
 * other file should import this module. That way, if a variable
 * name ever changes, we only update it in ONE place.
 * --------------------------------------------------------------
 */

require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Mapbox
  MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN || '',

  // Semaphore SMS
  SEMAPHORE_API_KEY: process.env.SEMAPHORE_API_KEY || '',
  SEMAPHORE_SENDER_NAME: process.env.SEMAPHORE_SENDER_NAME || 'RESCUE161',

  // Firebase
  FIREBASE_CREDENTIALS: process.env.FIREBASE_CREDENTIALS || '',
  FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL || '',

  // Station duty phones (Phase 2: dynamic station routing).
  // Fallbacks below are LOCAL-DEV PLACEHOLDERS ONLY — real duty
  // numbers must be set via Render env vars, never committed here.
  MDRRMO_BASE_PHONE: process.env.MDRRMO_BASE_PHONE || '+639170000001',
  ARMMC_ER_PHONE: process.env.ARMMC_ER_PHONE || '+639170000002',
  BFP_MAIN_STATION_PHONE: process.env.BFP_MAIN_STATION_PHONE || '+639170000003',
  BFP_STATION_2_PHONE: process.env.BFP_STATION_2_PHONE || '+639170000004',
  RIVER_COMMAND_PHONE: process.env.RIVER_COMMAND_PHONE || '+639170000005',
  PNP_MAIN_HQ_PHONE: process.env.PNP_MAIN_HQ_PHONE || '+639170000006',
  PNP_SUBSTATION_PHONE: process.env.PNP_SUBSTATION_PHONE || '+639170000007',
};
