/**
 * config/firebase.js
 * --------------------------------------------------------------
 * Firebase Admin SDK initialization.
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');

const {
  FIREBASE_CREDENTIALS,
  FIREBASE_CREDENTIALS_JSON,
  FIREBASE_DATABASE_URL,
} = require('./env');

let db = null;
let auth = null;

/**
 * Resolves the service-account credentials without ever returning
 * their contents to logs or error messages.
 *
 * Option B — FIREBASE_CREDENTIALS_JSON: the service-account JSON as
 * a single-line environment variable. Preferred for CI/Render, where
 * a credential file must not exist in the repo or on disk.
 *
 * Option A — FIREBASE_CREDENTIALS: the existing local file path,
 * resolved with require() exactly as before.
 *
 * Option B wins when both are set.
 * @returns {Object} parsed service-account object
 */
function loadServiceAccount() {
  if (FIREBASE_CREDENTIALS_JSON) {
    try {
      return JSON.parse(FIREBASE_CREDENTIALS_JSON);
    } catch (err) {
      throw new Error('FIREBASE_CREDENTIALS_JSON is set but is not valid JSON.');
    }
  }

  if (FIREBASE_CREDENTIALS) {
    return require(FIREBASE_CREDENTIALS);
  }

  throw new Error(
    'Firebase credentials missing: set FIREBASE_CREDENTIALS_JSON (CI/Render) or FIREBASE_CREDENTIALS (local file path).'
  );
}

function initializeFirebase() {
  try {
    if (!FIREBASE_DATABASE_URL) {
      throw new Error('FIREBASE_DATABASE_URL is required.');
    }

    const serviceAccount = loadServiceAccount();

    const app =
      getApps().length === 0
        ? initializeApp({
            credential: cert(serviceAccount),
            databaseURL: FIREBASE_DATABASE_URL,
          })
        : getApps()[0];

    db = getDatabase(app);
    auth = getAuth(app);

    console.log('✅ Firebase Realtime Database connected.');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    throw error;
  }
}

function getDb() {
  if (!db) {
    throw new Error(
      'Firebase Database is not initialized. Call initializeFirebase() first.'
    );
  }

  return db;
}

/**
 * Returns the Firebase Auth instance (same initialized app as RTDB).
 * Throws the same way getDb() does if initializeFirebase() hasn't run.
 */
function getFirebaseAuth() {
  if (!auth) {
    throw new Error(
      'Firebase Auth is not initialized. Call initializeFirebase() first.'
    );
  }

  return auth;
}

module.exports = {
  initializeFirebase,
  getDb,
  getFirebaseAuth,
};