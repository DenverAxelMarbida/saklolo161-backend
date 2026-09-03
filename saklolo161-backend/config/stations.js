/**
 * config/stations.js
 * --------------------------------------------------------------
 * Phase 2 station directory for Marikina City, grouped by incident
 * category (Medical, Fire, Flood, Crime).
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
    name: 'MDRRMO Base - Sta. Elena',
    category: 'Medical',
    phone: MDRRMO_BASE_PHONE,
    assignedUnits: ['MDRRMO Ambulance 1', 'MDRRMO Rescue Van'],
    estimatedTurnout: '5-8 mins',
  },
  {
    id: 'MEDICAL_ARMMC_ER',
    name: 'ARMMC ER Unit - Sumulong',
    category: 'Medical',
    phone: ARMMC_ER_PHONE,
    assignedUnits: ['ARMMC Ambulance 1'],
    estimatedTurnout: '8-12 mins',
  },

  // ---- FIRE ----
  {
    id: 'FIRE_BFP_MAIN_STATION',
    name: 'BFP Main Station - Shoe Ave',
    category: 'Fire',
    phone: BFP_MAIN_STATION_PHONE,
    assignedUnits: ['BFP Fire Truck #1', 'BFP Rescue Unit'],
    estimatedTurnout: '6-10 mins',
  },
  {
    id: 'FIRE_BFP_STATION_2',
    name: 'BFP Station 2 - Sto. Niño',
    category: 'Fire',
    phone: BFP_STATION_2_PHONE,
    assignedUnits: ['BFP Fire Truck #2'],
    estimatedTurnout: '5-9 mins',
  },

  // ---- FLOOD ----
  {
    id: 'FLOOD_RIVER_COMMAND',
    name: 'Marikina River Command - Riverbanks Center',
    category: 'Flood',
    phone: RIVER_COMMAND_PHONE,
    assignedUnits: ['River Rescue Boat 1', 'Flood Response Truck'],
    estimatedTurnout: '10-15 mins',
  },

  // ---- CRIME ----
  {
    id: 'CRIME_PNP_MAIN_HQ',
    name: 'PNP Main HQ - Sta. Elena',
    category: 'Crime',
    phone: PNP_MAIN_HQ_PHONE,
    assignedUnits: ['PNP Mobile Patrol 1', 'PNP Mobile Patrol 2'],
    estimatedTurnout: '5-8 mins',
  },
  {
    id: 'CRIME_PNP_SUBSTATION',
    name: 'PNP Sub-Station - Concepcion Uno',
    category: 'Crime',
    phone: PNP_SUBSTATION_PHONE,
    assignedUnits: ['PNP Mobile Patrol 3'],
    estimatedTurnout: '7-10 mins',
  },
];

module.exports = stations;
