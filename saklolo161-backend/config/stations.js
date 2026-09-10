/**
 * config/stations.js
 * --------------------------------------------------------------
 * Phase 2 station directory for Marikina City, grouped by incident
 * category (Medical, Fire, Flood, Crime).
 *
 * `coords` are the dispatch-anchor coordinates used by
 * services/routingService.js (and the dispatched `station` block) —
 * approximate station locations in Marikina, lat/lng decimal degrees.
 *
 * Phone numbers come from config/env.js (which itself reads
 * process.env with local-dev fallbacks) — this file never touches
 * process.env directly, matching the "single source of truth" rule
 * documented at the top of config/env.js.
 *
 * PHASE 3 NOTE:
 * This array is what gets seeded into the Firebase Realtime
 * Database's `/stations` node (e.g. via a one-time migration
 * script that loops over `stations` and writes each entry to
 * `db.ref('stations/' + station.id).set(station)`).
 *
 * Once that migration is done and FIREBASE_DATABASE_URL is live,
 * services/stationService.js automatically starts reading from
 * Firebase instead of this file — see stationService.js for how
 * that switch happens without touching any controller code.
 * --------------------------------------------------------------
 */

const {
  MDRRMO_BASE_PHONE,
  ARMMC_ER_PHONE,
  BFP_MAIN_STATION_PHONE,
  BFP_STATION_2_PHONE,
  RIVER_COMMAND_PHONE,
  PNP_MAIN_HQ_PHONE,
  PNP_SUBSTATION_PHONE,
} = require('./env');

const stations = [
  // ---- MEDICAL ----
  {
    id: 'MEDICAL_MDRRMO_BASE',
    name: 'Marikina City Disaster Risk Reduction Management Office',
    category: 'Medical',
    phone: MDRRMO_BASE_PHONE,
    coords: { lat: 14.662746008271984, lng: 121.1214855893322 },
    assignedUnits: ['Rescue 161 Ambulance #1', 'Ambulance #2', 'Heavy Rescue Truck #1'],
    estimatedTurnout: '2–5 mins',
  },
  {
    id: 'MEDICAL_ARMMC_ER',
    name: 'Amang Rodriguez Memorial Medical Center',
    category: 'Medical',
    phone: ARMMC_ER_PHONE,
    coords: { lat: 14.63619472044386, lng: 121.09842001511032 },
    assignedUnits: ['ARMMC ALS Ambulance #1', 'Mobile Trauma Unit'],
    estimatedTurnout: '3–6 mins',
  },

  // ---- FIRE ----
  {
    id: 'FIRE_BFP_MAIN_STATION',
    name: 'Bureau of Fire Protection Central Fire Station - Marikina City',
    category: 'Fire',
    phone: BFP_MAIN_STATION_PHONE,
    coords: { lat: 14.633094158302429, lng: 121.09756704853923 },
    assignedUnits: ['BFP Engine Pumper #1', 'BFP Engine Pumper #2', 'BFP Rescue Unit'],
    estimatedTurnout: '3–5 mins',
  },
  {
    id: 'FIRE_BFP_STATION_2',
    name: 'Barangay Emergency Response Team - BERT',
    category: 'Fire',
    phone: BFP_STATION_2_PHONE,
    coords: { lat: 14.650212306735304, lng: 121.09382962532607 },
    assignedUnits: ['BFP Engine Pumper #3', 'BFP Tanker #1'],
    estimatedTurnout: '4–6 mins',
  },

  // ---- FLOOD ----
  {
    id: 'FLOOD_RIVER_COMMAND',
    name: 'River Park Authority',
    category: 'Flood',
    phone: RIVER_COMMAND_PHONE,
    coords: { lat: 14.635687529310072, lng: 121.09384592111986 },
    assignedUnits: ['Rescue Boat Unit #1', 'Rescue Boat Unit #2', 'Amphibious Truck #1'],
    estimatedTurnout: '3–6 mins',
  },

  // ---- CRIME ----
  {
    id: 'CRIME_PNP_MAIN_HQ',
    name: 'Marikina City Police Headquarters',
    category: 'Crime',
    phone: PNP_MAIN_HQ_PHONE,
    coords: { lat: 14.663565945837846, lng: 121.12160587795394 },
    assignedUnits: ['Mobile Patrol #101', 'Mobile Patrol #102', 'SWAT Van #1'],
    estimatedTurnout: '3–5 mins',
  },
  {
    id: 'CRIME_PNP_SUBSTATION',
    name: 'Barangka Police Sub-Station Marikina City',
    category: 'Crime',
    phone: PNP_SUBSTATION_PHONE,
    coords: { lat: 14.63302060670905, lng: 121.08216607359721 },
    assignedUnits: ['Mobile Patrol #103', 'Mobile Patrol #104', 'Mobile Patrol #105'],
    estimatedTurnout: '4–8 mins',
  },
];

module.exports = stations;