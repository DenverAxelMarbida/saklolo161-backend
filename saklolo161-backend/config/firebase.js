/**
 * config/firebase.js
 * --------------------------------------------------------------
 * Firebase Admin SDK initialization.
 *
 * PHASE 1 NOTE:
 * We are running in MOCK MODE for now — controllers use in-memory
 * data (see /data/mockIncidents.js) so the mobile app and web
 * dashboard teams can build their UIs without waiting on a live
 * database connection.
 *
 * When the Database/Notification Engine developer is ready to
 * connect to the real Firebase Realtime Database:
 *   1. Download the service account key from the Firebase console
 *      (Project Settings > Service Accounts > Generate new private key)
 *   2. Save it as /config/serviceAccountKey.json (already gitignored)
 *   3. Set FIREBASE_CREDENTIALS and FIREBASE_DATABASE_URL in .env
 *   4. Uncomment the initialization code below
 *   5. Replace the mock data calls in /controllers/incidentController.js
 *      with real calls to `db.ref('incidents')`
 * --------------------------------------------------------------
 */

const { FIREBASE_CREDENTIALS, FIREBASE_DATABASE_URL } = require('./env');

let db = null;

function initializeFirebase() {
  try {
    // --- REAL FIREBASE INITIALIZATION (uncomment when ready) -------
    //
    // const admin = require('firebase-admin');
    // const serviceAccount = require(FIREBASE_CREDENTIALS);
    //
    // admin.initializeApp({
    //   credential: admin.credential.cert(serviceAccount),
    //   databaseURL: FIREBASE_DATABASE_URL,
    // });
    //
    // db = admin.database();
    // console.log('✅ Firebase Realtime Database connected.');
    // -----------------------------------------------------------------

    console.log('ℹ️  Firebase is running in MOCK MODE (Phase 1). No live DB connection made.');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
  }
}

module.exports = { initializeFirebase, getDb: () => db };
