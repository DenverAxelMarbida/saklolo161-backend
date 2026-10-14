/**
 * test/stationAdmin.test.mjs
 * --------------------------------------------------------------
 * HTTP tests for the station + assigned-unit management surface
 * (GET/POST/PATCH /api/stations, unit sub-routes) and the extended
 * dispatch validation (inactive station/unit rejection).
 *
 * Like userAdmin.test.mjs, these tests MOCK Firebase — station
 * coverage must not touch (or depend on) the real Firebase project:
 *   - authService.verifyToken → decodes fake admin/dispatcher tokens
 *     (verifyAuth + requireAdmin still run for real).
 *   - config/firebase.getDb → an in-memory fake RTDB supporting the
 *     ref()/once()/set()/update() calls stationService and
 *     incidentService make.
 * The 401/403 boundary is therefore exercised end-to-end through
 * the actual middleware chain, and dispatch tests run the real
 * dispatchController (Mapbox blanked → straight-line ETA fallback).
 * --------------------------------------------------------------
 */

import './blank-mapbox.mjs';

import request from 'supertest';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import app from '../server.js';

const nativeRequire = createRequire(import.meta.url);
const authServiceNative = nativeRequire('../services/authService.js');
const firebaseNative = nativeRequire('../config/firebase.js');

const originalVerifyToken = authServiceNative.verifyToken;
const originalVerifyPassword = authServiceNative.verifyPassword;
const originalGetDb = firebaseNative.getDb;

const ADMIN_TOKEN = 'station-admin-token';
const DISPATCHER_TOKEN = 'station-dispatcher-token';
// The ADMIN's own password, supplied for reauthentication on
// sensitive actions (station edit, station deactivation).
const ADMIN_PASSWORD = 'AdminPass!xK9pQ2';

const adminAuth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const dispatcherAuth = { Authorization: `Bearer ${DISPATCHER_TOKEN}` };

// ---- In-memory fake RTDB -------------------------------------------------
// Supports only what the services under test use:
//   db.ref(path).once('value') → { val(), exists() }
//   db.ref(path).set(value) / .update(patch)

function splitPath(path) {
  return String(path).split('/').filter(Boolean);
}

function makeFakeDb(seed) {
  let store = structuredClone(seed);

  const getNode = (path) => {
    let node = store;
    for (const key of splitPath(path)) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[key];
    }
    return node;
  };

  const setNode = (path, value) => {
    const keys = splitPath(path);
    let node = store;
    for (let i = 0; i < keys.length - 1; i++) {
      if (node[keys[i]] == null || typeof node[keys[i]] !== 'object') {
        node[keys[i]] = {};
      }
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
  };

  return {
    __store: () => store,
    ref(path) {
      return {
        once: async () => {
          const value = getNode(path);
          const clone = value === undefined ? null : structuredClone(value);
          return {
            val: () => clone,
            exists: () => value !== undefined && value !== null,
          };
        },
        set: async (value) => {
          setNode(path, structuredClone(value));
        },
        update: async (patch) => {
          const current = getNode(path);
          if (current === undefined || current === null) setNode(path, {});
          Object.assign(getNode(path), structuredClone(patch));
        },
      };
    },
  };
}

// Legacy-shaped record (as scripts/seedStations.js writes it: string
// units, no isActive) + a managed record (object units, one inactive).
function seedStations() {
  return {
    stations: {
      FIRE_BFP_MAIN_STATION: {
        id: 'FIRE_BFP_MAIN_STATION',
        name: 'Bureau of Fire Protection Central Fire Station - Marikina City',
        category: 'Fire',
        phone: '(02) 8681 0233',
        coords: { lat: 14.633094158302429, lng: 121.09756704853923 },
        assignedUnits: ['BFP Engine Pumper #1', 'BFP Engine Pumper #2'],
        estimatedTurnout: '3–5 mins',
      },
      FLOOD_RIVER_COMMAND: {
        id: 'FLOOD_RIVER_COMMAND',
        name: 'River Park Authority',
        category: 'Flood',
        phone: '(02) 8541 7461',
        coords: { lat: 14.635687529310072, lng: 121.09384592111986 },
        assignedUnits: [
          { id: 'boat-1', name: 'Rescue Boat Unit #1', isActive: true },
          { id: 'boat-2', name: 'Rescue Boat Unit #2', isActive: false },
        ],
        estimatedTurnout: '3–6 mins',
        isActive: false,
      },
    },
    incidents: {
      'INC-TEST-FLOOD-01': {
        incidentId: 'INC-TEST-FLOOD-01',
        citizenPhone: '+639170009001',
        category: 'Flood',
        location: { latitude: 14.6507, longitude: 121.1029, address: 'Brgy. Tumana, Marikina City' },
        status: 'Pending',
        notes: 'Station test incident.',
        timestamp: new Date().toISOString(),
      },
    },
  };
}

let fakeDb;

beforeAll(() => {
  authServiceNative.verifyToken = vi.fn(async (token) => {
    if (token === ADMIN_TOKEN) {
      return { uid: 'uid-admin', email: 'admin@marikina.gov.ph', agency: 'ALL', role: 'admin' };
    }
    if (token === DISPATCHER_TOKEN) {
      return { uid: 'uid-flood', email: 'flood@marikina.gov.ph', agency: 'FLOOD', role: 'dispatcher' };
    }
    throw new Error('Invalid or expired token.');
  });

  // Current-password re-verification for admin reauthentication —
  // default "correct"; individual tests override with
  // mockResolvedValueOnce(false).
  authServiceNative.verifyPassword = vi.fn(async () => true);

  firebaseNative.getDb = () => fakeDb;
});

afterAll(() => {
  authServiceNative.verifyToken = originalVerifyToken;
  authServiceNative.verifyPassword = originalVerifyPassword;
  firebaseNative.getDb = originalGetDb;
});

beforeEach(() => {
  fakeDb = makeFakeDb(seedStations());
  authServiceNative.verifyPassword.mockReset();
  authServiceNative.verifyPassword.mockResolvedValue(true);
});

describe('GET /api/stations — auth boundary + active filtering', () => {
  it('1. returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/stations');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('2. returns 403-safe 200 for a dispatcher with ACTIVE stations only', async () => {
    const res = await request(app).get('/api/stations').set(dispatcherAuth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // FLOOD_RIVER_COMMAND is seeded inactive → hidden from dispatchers.
    expect(res.body.data.map((s) => s.id)).toEqual(['FIRE_BFP_MAIN_STATION']);
  });

  it('3. ?includeInactive=true is ignored for dispatchers (still active only)', async () => {
    const res = await request(app).get('/api/stations?includeInactive=true').set(dispatcherAuth);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.id)).toEqual(['FIRE_BFP_MAIN_STATION']);
  });

  it('4. admin with ?includeInactive=true sees inactive records too', async () => {
    const res = await request(app).get('/api/stations?includeInactive=true').set(adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.id).sort()).toEqual(
      ['FIRE_BFP_MAIN_STATION', 'FLOOD_RIVER_COMMAND']
    );
  });

  it('5. ?category= filters, and rejects an unknown category with 400', async () => {
    const ok = await request(app).get('/api/stations?category=Fire').set(adminAuth);
    expect(ok.status).toBe(200);
    expect(ok.body.data.map((s) => s.id)).toEqual(['FIRE_BFP_MAIN_STATION']);

    const bad = await request(app).get('/api/stations?category=Plumbing').set(adminAuth);
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);
  });

  it('6. legacy records normalize: missing isActive means active, string units become objects', async () => {
    const res = await request(app).get('/api/stations/FIRE_BFP_MAIN_STATION').set(dispatcherAuth);
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.assignedUnits).toEqual([
      { id: 'BFP Engine Pumper #1', name: 'BFP Engine Pumper #1', isActive: true },
      { id: 'BFP Engine Pumper #2', name: 'BFP Engine Pumper #2', isActive: true },
    ]);
  });

  it('7. inactive stations 404 for dispatchers but 200 for admins', async () => {
    const asDispatcher = await request(app).get('/api/stations/FLOOD_RIVER_COMMAND').set(dispatcherAuth);
    expect(asDispatcher.status).toBe(404);

    const asAdmin = await request(app).get('/api/stations/FLOOD_RIVER_COMMAND').set(adminAuth);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.isActive).toBe(false);
  });
});

describe('POST /api/stations — admin management (reauth + initial units required)', () => {
  const validBody = {
    id: 'MEDICAL_TEST_BASE',
    name: 'Test Medical Base',
    category: 'Medical',
    phone: '161',
    coords: { lat: 14.65, lng: 121.1 },
    estimatedTurnout: '5 mins',
    assignedUnits: [{ id: 'amb-1', name: 'Ambulance 1' }],
    adminPassword: ADMIN_PASSWORD,
  };

  it('8. returns 403 when a dispatcher attempts to create a station', async () => {
    const res = await request(app).post('/api/stations').set(dispatcherAuth).send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('9. creates the station (201) with its initial units after admin reauth, in one write', async () => {
    const res = await request(app).post('/api/stations').set(adminAuth).send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('MEDICAL_TEST_BASE');
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.assignedUnits).toEqual([
      { id: 'amb-1', name: 'Ambulance 1', isActive: true },
    ]);

    // Reauthenticated against the ACTING admin's email from the token.
    expect(authServiceNative.verifyPassword).toHaveBeenCalledWith(
      'admin@marikina.gov.ph',
      ADMIN_PASSWORD,
    );

    // The station AND its units landed together (single atomic set()).
    const stored = fakeDb.__store().stations.MEDICAL_TEST_BASE;
    expect(stored).toBeTruthy();
    expect(stored.name).toBe('Test Medical Base');
    expect(stored.assignedUnits).toEqual([
      { id: 'amb-1', name: 'Ambulance 1', isActive: true },
    ]);
    // adminPassword is stripped before the service ever sees it.
    expect(stored).not.toHaveProperty('adminPassword');
    expect(res.body.data).not.toHaveProperty('adminPassword');
  });

  it('9b. rejects creation without adminPassword and persists NOTHING', async () => {
    const { adminPassword, ...withoutPassword } = validBody;
    const res = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send(withoutPassword);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/administrator password is required/i);
    // No partial station-without-units state in the store.
    expect(fakeDb.__store().stations.MEDICAL_TEST_BASE).toBeUndefined();
  });

  it('9c. rejects an incorrect adminPassword and persists NOTHING', async () => {
    authServiceNative.verifyPassword.mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({ ...validBody, id: 'MEDICAL_WRONG_PW' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/administrator password is incorrect/i);
    expect(authServiceNative.verifyPassword).toHaveBeenCalledWith(
      'admin@marikina.gov.ph',
      ADMIN_PASSWORD,
    );
    expect(fakeDb.__store().stations.MEDICAL_WRONG_PW).toBeUndefined();
  });

  it('9d. rejects creation with zero assigned units and persists NOTHING', async () => {
    const res = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({ ...validBody, id: 'MEDICAL_NO_UNITS', assignedUnits: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one assigned unit/i);
    expect(fakeDb.__store().stations.MEDICAL_NO_UNITS).toBeUndefined();
  });

  it('9e. rejects missing assignedUnits entirely (same rule as empty)', async () => {
    const { assignedUnits, ...noUnitsField } = validBody;
    const res = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({ ...noUnitsField, id: 'MEDICAL_NO_UNITS_FIELD' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one assigned unit/i);
    expect(fakeDb.__store().stations.MEDICAL_NO_UNITS_FIELD).toBeUndefined();
  });

  it('9f. rejects invalid unit ids/names and duplicate unit ids with 400', async () => {
    const bannedChar = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({
        ...validBody,
        id: 'MEDICAL_BAD_UNIT',
        assignedUnits: [{ id: 'bad/id', name: 'Broken' }],
      });
    expect(bannedChar.status).toBe(400);
    expect(fakeDb.__store().stations.MEDICAL_BAD_UNIT).toBeUndefined();

    const emptyName = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({
        ...validBody,
        id: 'MEDICAL_EMPTY_UNIT_NAME',
        assignedUnits: [{ id: 'u1', name: '   ' }],
      });
    expect(emptyName.status).toBe(400);
    expect(fakeDb.__store().stations.MEDICAL_EMPTY_UNIT_NAME).toBeUndefined();

    const duplicate = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({
        ...validBody,
        id: 'MEDICAL_DUP_UNITS',
        assignedUnits: [
          { id: 'u1', name: 'Unit One' },
          { id: 'u1', name: 'Unit One Again' },
        ],
      });
    expect(duplicate.status).toBe(400);
    expect(fakeDb.__store().stations.MEDICAL_DUP_UNITS).toBeUndefined();
  });

  it('10. rejects duplicate station ids with 409', async () => {
    const res = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({ ...validBody, id: 'FIRE_BFP_MAIN_STATION' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('11. rejects invalid category / missing name / bad coords with 400', async () => {
    const badCategory = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({ ...validBody, id: 'X_BAD_CAT', category: 'Plumbing' });
    expect(badCategory.status).toBe(400);

    const noName = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({ ...validBody, id: 'X_NO_NAME', name: '' });
    expect(noName.status).toBe(400);

    const badCoords = await request(app)
      .post('/api/stations')
      .set(adminAuth)
      .send({ ...validBody, id: 'X_BAD_COORDS', coords: { lat: 999, lng: 0 } });
    expect(badCoords.status).toBe(400);
  });
});

describe('PATCH /api/stations/:id — update + activate/deactivate', () => {
  it('12. updates station details (200) and preserves units/history fields', async () => {
    const res = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION')
      .set(adminAuth)
      .send({ name: 'Renamed Fire Station', phone: '161', adminPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Fire Station');
    expect(res.body.data.assignedUnits).toHaveLength(2);
    expect(fakeDb.__store().stations.FIRE_BFP_MAIN_STATION.name).toBe('Renamed Fire Station');
    // Reauthenticated against the ACTING admin's email from the token.
    expect(authServiceNative.verifyPassword).toHaveBeenCalledWith(
      'admin@marikina.gov.ph',
      ADMIN_PASSWORD,
    );
    // adminPassword is stripped before the service ever sees it —
    // it must never be persisted as a station field.
    expect(fakeDb.__store().stations.FIRE_BFP_MAIN_STATION).not.toHaveProperty('adminPassword');
    expect(res.body.data).not.toHaveProperty('adminPassword');
  });

  it('12b. rejects an edit without an adminPassword with 400 and leaves the station unchanged', async () => {
    const res = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION')
      .set(adminAuth)
      .send({ name: 'Should Not Persist' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Administrator password is required.');
    expect(fakeDb.__store().stations.FIRE_BFP_MAIN_STATION.name).toContain('Bureau of Fire Protection');
  });

  it('12c. rejects an edit with an incorrect admin password with 400 and leaves the station unchanged', async () => {
    authServiceNative.verifyPassword.mockResolvedValueOnce(false);
    const res = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION')
      .set(adminAuth)
      .send({ name: 'Should Not Persist', adminPassword: 'WrongPass!123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Administrator password is incorrect.');
    expect(fakeDb.__store().stations.FIRE_BFP_MAIN_STATION.name).toContain('Bureau of Fire Protection');
  });

  it('13. returns 404 for an unknown station', async () => {
    const res = await request(app)
      .patch('/api/stations/NOPE_NOT_HERE')
      .set(adminAuth)
      .send({ name: 'x', adminPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(404);
  });

  it('14. returns 403 for a dispatcher', async () => {
    const res = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION')
      .set(dispatcherAuth)
      .send({ name: 'Hacked Name' });
    expect(res.status).toBe(403);
    expect(fakeDb.__store().stations.FIRE_BFP_MAIN_STATION.name).toContain('Bureau of Fire Protection');
  });

  it('15. deactivation hides the station from dispatchers; reactivation restores it', async () => {
    const off = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION/status')
      .set(adminAuth)
      .send({ isActive: false, adminPassword: ADMIN_PASSWORD });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const hidden = await request(app).get('/api/stations').set(dispatcherAuth);
    expect(hidden.body.data).toEqual([]);

    const on = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION/status')
      .set(adminAuth)
      .send({ isActive: true });
    expect(on.status).toBe(200);
    const visible = await request(app).get('/api/stations').set(dispatcherAuth);
    expect(visible.body.data.map((s) => s.id)).toEqual(['FIRE_BFP_MAIN_STATION']);
    // Deactivation reauthenticated; reactivation did not.
    expect(authServiceNative.verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('15b. rejects deactivation without an adminPassword with 400 and keeps the station active', async () => {
    const res = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION/status')
      .set(adminAuth)
      .send({ isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Administrator password is required.');
    expect(fakeDb.__store().stations.FIRE_BFP_MAIN_STATION.isActive).not.toBe(false);
  });

  it('15c. rejects deactivation with an incorrect admin password with 400 and keeps the station active', async () => {
    authServiceNative.verifyPassword.mockResolvedValueOnce(false);
    const res = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION/status')
      .set(adminAuth)
      .send({ isActive: false, adminPassword: 'WrongPass!123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Administrator password is incorrect.');
    expect(fakeDb.__store().stations.FIRE_BFP_MAIN_STATION.isActive).not.toBe(false);
  });

  it('16. rejects a non-boolean isActive with 400', async () => {
    const res = await request(app)
      .patch('/api/stations/FIRE_BFP_MAIN_STATION/status')
      .set(adminAuth)
      .send({ isActive: 'yes' });
    expect(res.status).toBe(400);
    // Not a deactivation (isActive !== false) → no reauthentication attempted.
    expect(authServiceNative.verifyPassword).not.toHaveBeenCalled();
  });
});

describe('Unit management — add / rename / activate-deactivate', () => {
  it('17. adds a unit (201) with id uniqueness enforced per station', async () => {
    const res = await request(app)
      .post('/api/stations/FIRE_BFP_MAIN_STATION/units')
      .set(adminAuth)
      .send({ id: 'engine-9', name: 'Engine Pumper #9' });
    expect(res.status).toBe(201);
    expect(res.body.data.assignedUnits.some((u) => u.id === 'engine-9')).toBe(true);

    const dup = await request(app)
      .post('/api/stations/FIRE_BFP_MAIN_STATION/units')
      .set(adminAuth)
      .send({ id: 'engine-9', name: 'Duplicate' });
    expect(dup.status).toBe(409);
  });

  it('18. rejects unit creation on an unknown station (404) and for dispatchers (403)', async () => {
    const missing = await request(app)
      .post('/api/stations/NOPE/units')
      .set(adminAuth)
      .send({ id: 'u1', name: 'Unit 1' });
    expect(missing.status).toBe(404);

    const forbidden = await request(app)
      .post('/api/stations/FIRE_BFP_MAIN_STATION/units')
      .set(dispatcherAuth)
      .send({ id: 'u1', name: 'Unit 1' });
    expect(forbidden.status).toBe(403);
  });

  it('19. renames a unit; unknown unit 404s', async () => {
    const res = await request(app)
      .patch('/api/stations/FLOOD_RIVER_COMMAND/units/boat-1')
      .set(adminAuth)
      .send({ name: 'Rescue Boat Alpha' });
    expect(res.status).toBe(200);
    expect(res.body.data.assignedUnits.find((u) => u.id === 'boat-1').name).toBe('Rescue Boat Alpha');

    const missing = await request(app)
      .patch('/api/stations/FLOOD_RIVER_COMMAND/units/ghost')
      .set(adminAuth)
      .send({ name: 'Ghost' });
    expect(missing.status).toBe(404);
  });

  it('20. deactivating a unit keeps it stored but flags it inactive', async () => {
    const res = await request(app)
      .patch('/api/stations/FLOOD_RIVER_COMMAND/units/boat-1/status')
      .set(adminAuth)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    const unit = res.body.data.assignedUnits.find((u) => u.id === 'boat-1');
    expect(unit.isActive).toBe(false);
    // History preserved — the record still exists.
    expect(res.body.data.assignedUnits.some((u) => u.id === 'boat-1')).toBe(true);
  });
});

describe('Dispatch validation — active-state + membership', () => {
  it('21. rejects dispatch to an inactive station with 400', async () => {
    const res = await request(app)
      .post('/api/incidents/dispatch')
      .set(dispatcherAuth)
      .send({ incidentId: 'INC-TEST-FLOOD-01', stationId: 'FLOOD_RIVER_COMMAND', assignedUnit: 'Rescue Boat Unit #1' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/inactive/);
  });

  it('22. rejects dispatch with an inactive unit, listing active alternatives', async () => {
    // Reactivate the station first so the unit check is what fires.
    await request(app).patch('/api/stations/FLOOD_RIVER_COMMAND/status').set(adminAuth).send({ isActive: true });
    const res = await request(app)
      .post('/api/incidents/dispatch')
      .set(dispatcherAuth)
      .send({ incidentId: 'INC-TEST-FLOOD-01', stationId: 'FLOOD_RIVER_COMMAND', assignedUnit: 'Rescue Boat Unit #2' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/inactive/);
    expect(res.body.availableUnits).toEqual(['Rescue Boat Unit #1']);
  });

  it('23. rejects a unit from the wrong station and a category mismatch', async () => {
    await request(app).patch('/api/stations/FLOOD_RIVER_COMMAND/status').set(adminAuth).send({ isActive: true });

    const wrongStation = await request(app)
      .post('/api/incidents/dispatch')
      .set(dispatcherAuth)
      .send({ incidentId: 'INC-TEST-FLOOD-01', stationId: 'FLOOD_RIVER_COMMAND', assignedUnit: 'BFP Engine Pumper #1' });
    expect(wrongStation.status).toBe(400);
    expect(wrongStation.body.message).toMatch(/not a registered unit/);

    const mismatch = await request(app)
      .post('/api/incidents/dispatch')
      .set(dispatcherAuth)
      .send({ incidentId: 'INC-TEST-FLOOD-01', stationId: 'FIRE_BFP_MAIN_STATION', assignedUnit: 'BFP Engine Pumper #1' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.message).toMatch(/handles Fire incidents, not Flood/);
  });

  it('24. successful dispatch keeps the contract: top-level station.coords + dispatch block', async () => {
    await request(app).patch('/api/stations/FLOOD_RIVER_COMMAND/status').set(adminAuth).send({ isActive: true });
    const res = await request(app)
      .post('/api/incidents/dispatch')
      .set(dispatcherAuth)
      .send({ incidentId: 'INC-TEST-FLOOD-01', stationId: 'FLOOD_RIVER_COMMAND', assignedUnit: 'Rescue Boat Unit #1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('Dispatched');
    expect(res.body.data.station.id).toBe('FLOOD_RIVER_COMMAND');
    expect(res.body.data.station.coords).toEqual({ lat: 14.635687529310072, lng: 121.09384592111986 });
    expect(res.body.data.dispatch.assignedUnit).toBe('Rescue Boat Unit #1');
    expect(res.body.data.dispatch.stationId).toBe('FLOOD_RIVER_COMMAND');
  });
});

describe('Firebase unavailable — reads degrade, writes never fake success', () => {
  it('25. reads fall back to the static config when Firebase is down', async () => {
    firebaseNative.getDb = () => {
      throw new Error('Firebase Database is not initialized.');
    };
    try {
      const res = await request(app).get('/api/stations').set(dispatcherAuth);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    } finally {
      firebaseNative.getDb = () => fakeDb;
    }
  });

  it('26. writes fail with 503 + success:false (never reported as saved)', async () => {
    firebaseNative.getDb = () => {
      throw new Error('Firebase Database is not initialized.');
    };
    try {
      const create = await request(app)
        .post('/api/stations')
        .set(adminAuth)
        .send({
          id: 'X_DOWN',
          name: 'Down Test',
          category: 'Fire',
          assignedUnits: [{ id: 'eng-down', name: 'Engine Down' }],
          adminPassword: ADMIN_PASSWORD,
        });
      expect(create.status).toBe(503);
      expect(create.body.success).toBe(false);

      const deactivate = await request(app)
        .patch('/api/stations/FIRE_BFP_MAIN_STATION/status')
        .set(adminAuth)
        .send({ isActive: false, adminPassword: ADMIN_PASSWORD });
      expect(deactivate.status).toBe(503);
      expect(deactivate.body.success).toBe(false);
    } finally {
      firebaseNative.getDb = () => fakeDb;
    }
  });
});
