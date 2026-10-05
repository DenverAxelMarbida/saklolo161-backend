/**
 * scripts/seedStations.js
 * --------------------------------------------------------------
 * One-time / re-runnable seeder for the Firebase RTDB `/stations`
 * node (Phase 3, Task 5 item 3).
 *
 * Writes each entry from config/stations.js to
 *     /stations/{station.id}
 * using the station ID as the Firebase child key — which is exactly
 * how services/stationService.js reads it back
 * (`db.ref('stations/${stationId}')`).
 *
 * Idempotent: `.set()` replaces each child with the source object,
 * so re-running after a data change simply re-syncs RTDB to
 * config/stations.js. Re-run it whenever a station changes.
 *
 * Usage:
 *     node scripts/seedStations.js
 *
 * Prints only safe summary output — never phone numbers,
 * credentials, or .env values.
 * --------------------------------------------------------------
 */

const stations = require('../config/stations');
const { initializeFirebase, getDb } = require('../config/firebase');

async function main() {
  initializeFirebase();
  const db = getDb();

  for (const station of stations) {
    await db.ref(`stations/${station.id}`).set(station);
  }

  console.log(`✅  Seeded ${stations.length} stations to RTDB /stations (keyed by station id).`);

  // firebase-admin keeps a credential-refresh timer alive; exit
  // explicitly so the CLI returns to the shell instead of hanging.
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  Seeding failed:', err.message);
  process.exit(1);
});
