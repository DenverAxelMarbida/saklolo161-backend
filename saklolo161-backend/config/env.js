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

  // OpenWeather Map
  OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY || '',
  
  // Mapbox
  MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN || '',

  // Semaphore SMS
  SEMAPHORE_API_KEY: process.env.SEMAPHORE_API_KEY || '',
  SEMAPHORE_SENDER_NAME: process.env.SEMAPHORE_SENDER_NAME || 'RESCUE161',

  // Firebase
  FIREBASE_CREDENTIALS: process.env.FIREBASE_CREDENTIALS || '',
  FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL || '',
};
