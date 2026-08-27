/**
 * data/mockIncidents.js
 * --------------------------------------------------------------
 * In-memory "database" used ONLY for Phase 1 mock endpoints.
 *
 * This lets the Mobile UI and Web Dashboard developers start
 * building and testing screens immediately, without waiting for
 * the real Firebase Realtime Database integration.
 *
 * This array is mutated at runtime by the controllers (new
 * incidents get pushed, statuses get updated), but it resets
 * every time the server restarts — that's expected for mock mode.
 * --------------------------------------------------------------
 */

let incidents = [
  {
    incidentId: 'INC-20250811-0001',
    citizenPhone: '+639171234567',
    category: 'Flood',
    location: {
      latitude: 14.6507,
      longitude: 121.1029,
      address: 'Brgy. Tumana, Marikina City',
    },
    status: 'Pending',
    notes: 'Waist-deep floodwater near the riverbank, family requesting rescue.',
    timestamp: '2025-08-11T06:15:00.000Z',
  },
  {
    incidentId: 'INC-20250811-0002',
    citizenPhone: '+639189876543',
    category: 'Fire',
    location: {
      latitude: 14.6355,
      longitude: 121.0965,
      address: 'Brgy. Malanday, Marikina City',
    },
    status: 'Dispatched',
    notes: 'Residential fire, two-story house, smoke visible from main road.',
    timestamp: '2025-08-11T07:02:00.000Z',
  },
  {
    incidentId: 'INC-20250811-0003',
    citizenPhone: '+639201112233',
    category: 'Medical',
    location: {
      latitude: 14.6297,
      longitude: 121.0784,
      address: 'Brgy. Concepcion Uno, Marikina City',
    },
    status: 'Resolved',
    notes: 'Elderly patient experiencing chest pains, transported to hospital.',
    timestamp: '2025-08-10T22:40:00.000Z',
  },
  {
    incidentId: 'INC-20250812-0004',
    citizenPhone: '+639225556677',
    category: 'Flood',
    location: {
      latitude: 14.6462,
      longitude: 121.1102,
      address: 'Brgy. Nangka, Marikina City',
    },
    status: 'Pending',
    notes: 'Street flooding rising fast, several vehicles stranded.',
    timestamp: '2025-08-12T04:55:00.000Z',
  },
  {
    incidentId: 'INC-20250812-0005',
    citizenPhone: '+639338889900',
    category: 'Crime',
    location: {
      latitude: 14.6221,
      longitude: 121.0902,
      address: 'Brgy. Sto. Niño, Marikina City',
    },
    status: 'Dispatched',
    notes: 'Robbery reported in convenience store near public market, suspect fled on foot.',
    timestamp: '2025-08-12T09:18:00.000Z',
  },
];

module.exports = {
  getAll: () => incidents,
  add: (incident) => {
    incidents.push(incident);
    return incident;
  },
  findById: (id) => incidents.find((inc) => inc.incidentId === id),
  updateStatus: (id, status) => {
    const incident = incidents.find((inc) => inc.incidentId === id);
    if (incident) incident.status = status;
    return incident;
  },
};
