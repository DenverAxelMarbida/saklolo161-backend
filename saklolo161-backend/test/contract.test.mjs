/**
 * test/contract.test.mjs
 * --------------------------------------------------------------
 * Phase 3 contract tests. These pin the SHAPES the mobile and web
 * clients were built against (see ../Phase 3/saklolo161-phase3-
 * contracts.md), not implementation details:
 *
 *   GET  /api/weather-river           → `source: "pagasa" | "mock"`
 *   GET  /api/routes                  → LineString + distance/duration
 *   POST /api/incidents               → `evidence: []` in the response
 *   GET  /api/incidents/:id           → public + `evidence[]`
 *   POST /api/incidents/:id/evidence  → record shape, 404, size limit
 *   GET  /api/incidents/:id/evidence/:fileId/media → 200 stream, 404
 *   POST /api/incidents/dispatch      → top-level `station.coords`
 *   Auth boundary                      → list requires token, :id does not
 * --------------------------------------------------------------
 */

import request from 'supertest';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

// Must be imported BEFORE the app: blanks MAPBOX_ACCESS_TOKEN before
// config/env.js loads, so routing deterministically takes the
// straight-line fallback in the suite (no network in CI). Live
// Mapbox behavior is verified separately via smoke test.
import './blank-mapbox.mjs';

// Same reasoning for the PAGASA river feed: pointing it at a dead
// local port makes the widget test fail fast to `source: "mock"`
// instead of riding out an 8s network timeout past vitest's 5s.
import './blank-pagasa.mjs';

// And for TextBee: force TEXTBEE_API_KEY empty before config/env.js
// loads, so no app-level test path (incident create / dispatch / status)
// can ever reach the real SMS API.
import './blank-textbee.mjs';

import app from '../server.js';
import routingService from '../services/routingService.js';
import textbeeService from '../services/textbeeService.js';
import { createRequire } from 'node:module';

// sendSms() reads config/env through CommonJS `require`, which lands in
// Node's require cache — a DIFFERENT module instance from a vitest ESM
// `import env from`. Grab the shared instance here so these tests can
// actually flip TEXTBEE_API_KEY on the object the service reads.
const env = createRequire(import.meta.url)('../config/env.js');

// Same CJS/ESM instance reasoning as `env` above: the controllers
// `require()` their services, so a spyOn must target that exact module
// instance to be visible from the handler under test.
const incidentServiceCjs = createRequire(import.meta.url)(
  '../services/incidentService.js'
);

const MOCK_PASSWORD = 'changeme123';

// sendSms() must NEVER reject — it warns instead when TEXTBEE_API_KEY is
// missing, which is the suite's default state thanks to blank-textbee.mjs
// and would otherwise spam every incident/dispatch test. Silence console.warn
// globally; the missing-key test below asserts on warnSpy.
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
afterAll(() => warnSpy.mockRestore());

async function loginAs(agency) {
  const res = await request(app).post('/api/auth/login').send({
    email: `${agency.toLowerCase()}@marikina.gov.ph`,
    password: MOCK_PASSWORD,
  });
  expect(res.status).toBe(200);
  expect(res.body.data.token).toBeTruthy();
  return res.body.data.token;
}

const makeIncident = (category = 'Flood') => ({
  citizenPhone: '+639121987654',
  category,
  location: {
    latitude: 14.6507,
    longitude: 121.1029,
    address: 'Brgy. Tumana, Marikina City',
  },
  notes: 'Contract test incident.',
  timestamp: new Date().toISOString(),
});

describe('GET /api/weather-river', () => {
  it('returns the widget shape with source / mock / pagasa', async () => {
    const res = await request(app).get('/api/weather-river');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(typeof d.temperature).toBe('string');
    expect(['pagasa', 'mock']).toContain(d.source);
    expect(typeof d.riverLevelMeters).toBe('number');
    expect(['Normal', 'Alert', 'Alarm', 'Critical']).toContain(d.riverStatus);
    expect(typeof d.alertLevel).toBe('string');
    expect(typeof d.riskLevel).toBe('string');
    expect(new Date(d.timestamp).toString()).not.toBe('Invalid Date');
  });
});

describe('GET /api/routes', () => {
  it('validates the four numeric params (no spurious range errors on missing params)', async () => {
    const res = await request(app).get('/api/routes').query({ fromLat: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e) => e.includes('valid number'))).toBe(true);
    expect(res.body.errors.some((e) => e.includes('between'))).toBe(false);
  });

  it('reports range errors only for out-of-range numeric values', async () => {
    const res = await request(app)
      .get('/api/routes')
      .query({ fromLat: 95, fromLng: 121.093, toLat: 14.643, toLng: -200 });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('latitudes must be between -90 and 90.');
    expect(res.body.errors).toContain('longitudes must be between -180 and 180.');
    expect(res.body.errors.some((e) => e.includes('valid number'))).toBe(false);
  });

  it('returns the contract-shaped straight-line fallback (Mapbox blanked in suite)', async () => {
    const res = await request(app)
      .get('/api/routes')
      .query({ fromLat: 14.633, fromLng: 121.093, toLat: 14.643, toLng: 121.098 });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.geometry.type).toBe('LineString');
    // Fallback is a single straight segment: exactly two points.
    expect(d.geometry.coordinates).toHaveLength(2);
    expect(d.distanceMeters).toBeGreaterThan(0);
    expect(d.durationSeconds).toBeGreaterThan(0);
  });
});

describe('POST /api/incidents', () => {
  it('creates an incident whose response includes evidence: []', async () => {
    const res = await request(app).post('/api/incidents').send(makeIncident());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.incidentId).toBeTruthy();
    expect(res.body.data.evidence).toEqual([]);
  });

  it('defaults the additive evidence-progress fields off', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .send({ ...makeIncident(), citizenPhone: '+639121987655' });
    expect(res.status).toBe(201);
    expect(res.body.data.evidenceUploading).toBe(false);
    expect(res.body.data.evidenceExpectedCount).toBe(0);
    expect(res.body.data.evidenceFailedCount).toBe(0);
    expect(res.body.data.evidenceAttempt).toBe(0);
    expect(res.body.data.evidenceAttemptsTotal).toBe(0);
  });

  it('flips evidenceUploading on when the client declares an expected attachment count', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .send({ ...makeIncident(), citizenPhone: '+639121987656', evidenceExpectedCount: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data.evidenceExpectedCount).toBe(3);
    expect(res.body.data.evidenceUploading).toBe(true);
    expect(res.body.data.evidenceFailedCount).toBe(0);
  });
});

describe('POST /api/incidents/:id/evidence-status', () => {
  let incidentId;

  beforeAll(async () => {
    const created = await request(app)
      .post('/api/incidents')
      .send({ ...makeIncident(), citizenPhone: '+639121987657', evidenceExpectedCount: 2 });
    incidentId = created.body.data.incidentId;
  });

  it('clears evidenceUploading and records the failed count when the upload loop finishes', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/evidence-status`)
      .send({ evidenceUploading: false, evidenceFailedCount: 1 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.evidenceUploading).toBe(false);
    expect(res.body.data.evidenceFailedCount).toBe(1);
    expect(res.body.data.evidenceExpectedCount).toBe(2);

    // AND the update must be visible on the public detail endpoint too.
    const detail = await request(app).get(`/api/incidents/${incidentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.evidenceUploading).toBe(false);
    expect(detail.body.data.evidenceFailedCount).toBe(1);
  });

  it('400s for an invalid evidenceUploading type', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/evidence-status`)
      .send({ evidenceUploading: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('400s for a negative or non-integer count', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/evidence-status`)
      .send({ evidenceFailedCount: -1 });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('accepts and round-trips retry attempt progress', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/evidence-status`)
      .send({ evidenceUploading: true, evidenceAttempt: 2, evidenceAttemptsTotal: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data.evidenceAttempt).toBe(2);
    expect(res.body.data.evidenceAttemptsTotal).toBe(3);

    const detail = await request(app).get(`/api/incidents/${incidentId}`);
    expect(detail.body.data.evidenceAttempt).toBe(2);
    expect(detail.body.data.evidenceAttemptsTotal).toBe(3);
  });

  it('400s for a non-integer or negative attempt', async () => {
    for (const body of [{ evidenceAttempt: 1.5 }, { evidenceAttemptsTotal: -1 }]) {
      const res = await request(app)
        .post(`/api/incidents/${incidentId}/evidence-status`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  it('400s when no progress field is provided', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/evidence-status`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('404s for an unknown incident', async () => {
    const res = await request(app)
      .post('/api/incidents/INC-99999999-9999/evidence-status')
      .send({ evidenceUploading: false });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/incidents (auth boundary)', () => {
  it('rejects list without a dispatcher token', async () => {
    const res = await request(app).get('/api/incidents');
    expect(res.status).toBe(401);
  });

  it('accepts list with a dispatcher token', async () => {
    const token = await loginAs('flood');
    const res = await request(app).get('/api/incidents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/incidents/:id', () => {
  let incidentId;

  beforeAll(async () => {
    const created = await request(app)
      .post('/api/incidents')
      .send({ ...makeIncident(), citizenPhone: '+639121987658' });
    incidentId = created.body.data.incidentId;
  });

  it('is public and always includes an evidence array', async () => {
    const res = await request(app).get(`/api/incidents/${incidentId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.incidentId).toBe(incidentId);
    expect(Array.isArray(res.body.data.evidence)).toBe(true);
  });

  it('404s on an unknown id', async () => {
    const res = await request(app).get('/api/incidents/INC-99999999-9999');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/incidents/:id/status — resolvedAt persistence', () => {
  let incidentId;

  beforeEach(async () => {
    const created = await request(app)
      .post('/api/incidents')
      // Unique phone: the public create endpoint rate-limits to 3 reports
      // per phone per 10-minute window, and the suite's other creates
      // already share the default makeIncident() phone.
      .send({ ...makeIncident('Flood'), citizenPhone: '+639121987664' });
    incidentId = created.body.data.incidentId;
  });

  it('stores resolvedAt so every later read carries the same server timestamp', async () => {
    const token = await loginAs('flood');
    const patch = await request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Resolved' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.resolvedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(patch.body.data.resolvedAt))).toBe(false);

    // The regression this pins: the controller used to stamp resolvedAt
    // on the RESPONSE object only — the store never kept it, so every
    // subsequent read (web Resolved Log via GET list, mobile History via
    // GET :id) returned the incident WITHOUT a resolution time.
    const detail = await request(app).get(`/api/incidents/${incidentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.resolvedAt).toBe(patch.body.data.resolvedAt);

    // The dispatcher list endpoint (what the web dashboard polls).
    const list = await request(app)
      .get('/api/incidents')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const row = list.body.data.find((i) => i.incidentId === incidentId);
    expect(row).toBeTruthy();
    expect(row.resolvedAt).toBe(patch.body.data.resolvedAt);
  });
});

describe('dispatch → station anchor', () => {
  let incidentId;

  beforeAll(async () => {
    const created = await request(app).post('/api/incidents').send(makeIncident('Flood'));
    incidentId = created.body.data.incidentId;
  });

  it('exposes the responding station at the TOP level with coords', async () => {
    const token = await loginAs('flood');
    const res = await request(app)
      .post('/api/incidents/dispatch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        incidentId,
        stationId: 'FLOOD_RIVER_COMMAND',
        assignedUnit: 'Rescue Boat Unit #1',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Dispatched');
    expect(res.body.data.station).toBeTruthy();
    expect(res.body.data.station.id).toBe('FLOOD_RIVER_COMMAND');
    expect(res.body.data.station.name).toBeTruthy();
    expect(res.body.data.station.coords).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });

    // Dispatch now computes a real arrival ETA (whole minutes) so the
    // mobile tracker shows driving time, not readiness.
    expect(res.body.data.dispatch).toBeTruthy();
    expect(Number.isInteger(res.body.data.dispatch.arrivalEtaMinutes)).toBe(true);
    expect(res.body.data.dispatch.arrivalEtaMinutes).toBeGreaterThanOrEqual(1);

    // AND it must be visible on the public detail endpoint too.
    const detail = await request(app).get(`/api/incidents/${incidentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.station.coords.lat).toBe(14.635687529310072);
    expect(detail.body.data.station.coords.lng).toBe(121.09384592111986);
  });

  it('dispatch sends no SMS but still computes a real arrival ETA (fetch stubbed — no real SMS)', async () => {
    const token = await loginAs('flood');
    const expectedMin = Math.max(
      1,
      Math.round(
        (routingService.haversineMeters(
          14.635687529310072,
          121.09384592111986,
          14.6507,
          121.1029
        ) /
          (100000 / 9000)) /
          60
      )
    );

    // Stub fetch + configure a throwaway key so any SMS attempt would
    // be visible — the assertion below proves dispatch makes NO TextBee
    // request at all (start/end-only policy), and no network call
    // leaves the process.
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: { success: true, message: 'SMS added to queue for processing', smsBatchId: 'test-batch', recipientCount: 1 },
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    env.TEXTBEE_API_KEY = 'test-key-contract-suite';
    try {
      const res = await request(app)
        .post('/api/incidents/dispatch')
        .set('Authorization', `Bearer ${token}`)
        .send({
          incidentId,
          stationId: 'FLOOD_RIVER_COMMAND',
          assignedUnit: 'Rescue Boat Unit #1',
        });
      expect(res.status).toBe(200);
      expect(res.body.data.dispatch.arrivalEtaMinutes).toBe(expectedMin);

      const detail = await request(app).get(`/api/incidents/${incidentId}`);
      expect(detail.body.data.dispatch.arrivalEtaMinutes).toBe(expectedMin);

      // Give any (incorrect) background SMS a moment to appear.
      await new Promise((r) => setTimeout(r, 50));
      const textbeeCalls = fetchSpy.mock.calls.filter((call) => call[1]?.body);
      expect(textbeeCalls).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      env.TEXTBEE_API_KEY = '';
    }
  });
});

describe('SMS notification content (TextBee request bodies)', () => {
  // Start/end-only policy: the citizen gets a report confirmation at
  // creation and a resolution text on Resolved — dispatch and
  // intermediate statuses send nothing, to any phone. fetch is stubbed
  // and a throwaway key is set, so no real SMS can ever leave the suite.
  const TEST_KEY = 'test-key-contract-suite';
  const ORIGINAL_KEY = env.TEXTBEE_API_KEY;

  // Unique citizen phones — the public create endpoint rate-limits to
  // 3 reports per phone per 10-minute window.
  const MEDICAL_CITIZEN = '+639170001001';
  const FLOOD_CITIZEN = '+639170001002';
  const RESOLVED_CITIZEN = '+639170001005';
  const FAILING_CITIZEN = '+639170001007';

  let ids;
  let fetchSpy;

  beforeAll(async () => {
    const create = async (category, citizenPhone) => {
      const res = await request(app)
        .post('/api/incidents')
        .send({ ...makeIncident(category), citizenPhone });
      expect(res.status).toBe(201);
      return res.body.data.incidentId;
    };
    ids = {
      armmc: await create('Medical', MEDICAL_CITIZEN),
      flood: await create('Flood', FLOOD_CITIZEN),
      resolved: await create('Flood', RESOLVED_CITIZEN),
      failing: await create('Flood', FAILING_CITIZEN),
    };
  });

  beforeEach(() => {
    warnSpy.mockClear();
    fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          success: true,
          message: 'SMS added to queue for processing',
          smsBatchId: 'test-batch',
          recipientCount: 1,
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    env.TEXTBEE_API_KEY = TEST_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    env.TEXTBEE_API_KEY = ORIGINAL_KEY;
  });

  const sentBodies = () =>
    // Only the TextBee POSTs carry a body — the mapbox reverse-geocode
    // call (single-argument fetch) is stubbed too and must be skipped.
    fetchSpy.mock.calls
      .filter((call) => call[1]?.body)
      .map((call) => JSON.parse(call[1].body));
  const messagesTo = (phone) =>
    sentBodies()
      .filter((b) => b.recipients.includes(phone))
      .map((b) => b.message);
  const allMessages = () => sentBodies().map((b) => b.message);

  // SMS is enqueued fire-and-forget so the HTTP 200 does not wait on
  // TextBee. Poll until the expected number of fetch calls exist.
  async function waitForSms(minCount, timeoutMs = 2000) {
    const start = Date.now();
    while (fetchSpy.mock.calls.length < minCount) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `waitForSms: expected >= ${minCount} SMS fetch calls, saw ${fetchSpy.mock.calls.length} after ${timeoutMs}ms`
        );
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async function dispatchAs(token, incidentId, stationId, assignedUnit) {
    const res = await request(app)
      .post('/api/incidents/dispatch')
      .set('Authorization', `Bearer ${token}`)
      .send({ incidentId, stationId, assignedUnit });
    expect(res.status).toBe(200);
    return res;
  }

  it('dispatch sends no SMS to the citizen', async () => {
    const token = await loginAs('flood');
    await dispatchAs(token, ids.flood, 'FLOOD_RIVER_COMMAND', 'Rescue Boat Unit #1');

    // Give any (incorrect) background SMS a moment to appear.
    await new Promise((r) => setTimeout(r, 50));
    expect(sentBodies()).toHaveLength(0);
    expect(messagesTo(FLOOD_CITIZEN)).toHaveLength(0);
  });

  it('dispatch sends no SMS to any station phone', async () => {
    const token = await loginAs('medical');
    await dispatchAs(token, ids.armmc, 'MEDICAL_ARMMC_ER', 'ARMMC ALS Ambulance #1');

    await new Promise((r) => setTimeout(r, 50));
    expect(sentBodies()).toHaveLength(0);
    expect(
      allMessages().filter((m) => m.startsWith('SAKLOLO 161\nDISPATCH ALERT'))
    ).toHaveLength(0);
  });

  it('changing the status to En Route sends no SMS', async () => {
    const token = await loginAs('flood');
    const res = await request(app)
      .patch(`/api/incidents/${ids.flood}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'En Route' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('En Route');

    await new Promise((r) => setTimeout(r, 50));
    expect(sentBodies()).toHaveLength(0);
    expect(messagesTo(FLOOD_CITIZEN)).toHaveLength(0);
  });

  it('resolved SMS uses the new multi-line resolved layout with incident id', async () => {
    const token = await loginAs('flood');
    await dispatchAs(token, ids.resolved, 'FLOOD_RIVER_COMMAND', 'Rescue Boat Unit #1');
    const res = await request(app)
      .patch(`/api/incidents/${ids.resolved}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Resolved' });
    expect(res.status).toBe(200);
    await waitForSms(1);

    const msg = messagesTo(RESOLVED_CITIZEN).find((m) =>
      m.includes('INCIDENT RESOLVED')
    );
    expect(msg).toBeTruthy();
    const lines = msg.split('\n');
    expect(lines[0]).toBe('SAKLOLO 161');
    expect(lines[1]).toBe('INCIDENT RESOLVED');
    expect(msg).toContain(`Incident: ${ids.resolved}`);
    expect(msg).toContain('Status: Resolved');
    expect(msg).toContain('Your emergency response has been completed.');
    expect(msg).toContain('Thank you for using Saklolo 161.');
    expect(msg).not.toContain('Responding from:');
    expect(msg).not.toContain('STATUS UPDATE');
  });

  it('resolving a never-dispatched incident still sends exactly one resolution SMS', async () => {
    // No dispatch block, no station info — the resolution text must not
    // depend on either.
    const created = await request(app)
      .post('/api/incidents')
      .send({ ...makeIncident('Flood'), citizenPhone: '+639170001006' });
    expect(created.status).toBe(201);
    const token = await loginAs('flood');
    const res = await request(app)
      .patch(`/api/incidents/${created.body.data.incidentId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Resolved' });
    expect(res.status).toBe(200);
    await waitForSms(2);

    const msg = messagesTo('+639170001006').find((m) =>
      m.includes('INCIDENT RESOLVED')
    );
    expect(msg).toBeTruthy();
    expect(msg).toContain(`Incident: ${created.body.data.incidentId}`);
  });

  it('dispatch and status operations still succeed when the TextBee API fails', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const token = await loginAs('flood');

    const dispatchRes = await dispatchAs(
      token,
      ids.failing,
      'FLOOD_RIVER_COMMAND',
      'Rescue Boat Unit #1'
    );
    expect(dispatchRes.body.data.status).toBe('Dispatched');

    const patch = await request(app)
      .patch(`/api/incidents/${ids.failing}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Resolved' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.status).toBe('Resolved');
    // The resolution send was ATTEMPTED and its failure swallowed —
    // dispatch sent nothing, so the single attempt is the resolution.
    expect(sentBodies()).toHaveLength(1);
    expect(sentBodies()[0].message).toContain('INCIDENT RESOLVED');
  });
});

describe('SMS ordering, duplicates & failure isolation (regression)', () => {
  // Start/end-only policy: the citizen gets a report confirmation at
  // creation and a resolution text on Resolved — dispatch and
  // intermediate statuses send nothing, to any phone. Every case below
  // stubs fetch: no real SMS can leave the suite, and all phones are
  // test-only.
  const TEST_KEY = 'test-key-contract-suite';
  const ORIGINAL_KEY = env.TEXTBEE_API_KEY;
  const STATION_ALERT_DELAY_MS = 300;
  const STATION_ID = 'FLOOD_RIVER_COMMAND';
  const UNIT = 'Rescue Boat Unit #1';

  const ORDER_CITIZEN = '+639170002001';
  const COUNTS_CITIZEN = '+639170002002';
  const SEQUENCEDUP_CITIZEN = '+639170002003';
  const RACEDUP_CITIZEN = '+639170002004';
  const NODEDUP_CITIZEN = '+639170002005';
  const TIMEOUT_CITIZEN = '+639170002006';
  const HTTPFAIL_CITIZEN = '+639170002007';
  const FRESH_CITIZEN = '+639170002008';
  const BUILDFAIL_CITIZEN = '+639170002009';
  const CONCURRENT_CITIZEN = '+639170002010';

  let ids;
  let fetchSpy;
  let submissions;
  let mode;
  let textbeeGate;
  let textbeeGatePhone;
  let infoSpy;
  let errorSpy;

  beforeAll(async () => {
    // Created while TEXTBEE_API_KEY is still blank (beforeEach hasn't
    // run yet), so setup itself never triggers a send.
    const create = async (citizenPhone) => {
      const res = await request(app)
        .post('/api/incidents')
        .send({ ...makeIncident('Flood'), citizenPhone });
      expect(res.status).toBe(201);
      return res.body.data.incidentId;
    };
    ids = {
      order: await create(ORDER_CITIZEN),
      counts: await create(COUNTS_CITIZEN),
      sequencedup: await create(SEQUENCEDUP_CITIZEN),
      racedup: await create(RACEDUP_CITIZEN),
      nodup: await create(NODEDUP_CITIZEN),
      timeout: await create(TIMEOUT_CITIZEN),
      httpfail: await create(HTTPFAIL_CITIZEN),
      buildfail: await create(BUILDFAIL_CITIZEN),
      concurrent: await create(CONCURRENT_CITIZEN),
    };
  });

  beforeEach(() => {
    warnSpy.mockClear();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    submissions = [];
    mode = 'ok';
    textbeeGate = null;
    textbeeGatePhone = null;
    fetchSpy = vi.fn(async (url, init) => {
      // mapboxService.reverseGeocode also calls the global fetch with a
      // single argument — keep it on the same non-authorized fallback
      // path the suite sees with a blanked token, and only record the
      // TextBee sends (the ones that carry a JSON body).
      if (!init?.body || !String(url).includes('api.textbee.dev')) {
        return { ok: false, status: 401, json: async () => ({ message: 'No Token' }) };
      }
      const body = JSON.parse(init.body);
      const entry = {
        recipients: body.recipients,
        message: body.message,
        at: Date.now(),
        completed: false,
      };
      submissions.push(entry);
      if (mode === 'timeout') {
        const timeoutError = new Error('The operation was aborted due to timeout');
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      if (mode === 'http500') {
        return { ok: false, status: 500, json: async () => ({ message: 'gateway error' }) };
      }
      // Simulate a busy single-SIM gateway: the station alert occupies
      // the device for a while, which is what made the citizen text late.
      if (body.message.includes('DISPATCH ALERT')) {
        await new Promise((resolve) => setTimeout(resolve, STATION_ALERT_DELAY_MS));
      }
      // Gated provider: hang until the test releases the gate. If an
      // HTTP handler awaited this SMS job, the request would deadlock
      // (vitest timeout) — so a completed HTTP response while the gate
      // is still closed is proof of non-blocking SMS.
      if (
        mode === 'gated' &&
        textbeeGate &&
        (!textbeeGatePhone || body.recipients.includes(textbeeGatePhone))
      ) {
        await textbeeGate;
      }
      entry.completed = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            success: true,
            message: 'SMS added to queue for processing',
            smsBatchId: 'test-batch',
            recipientCount: 1,
          },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);
    env.TEXTBEE_API_KEY = TEST_KEY;
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    env.TEXTBEE_API_KEY = ORIGINAL_KEY;
  });

  const sentBodies = () =>
    // Only the TextBee POSTs carry a body — the mapbox reverse-geocode
    // call (single-argument fetch) is stubbed too and must be skipped.
    fetchSpy.mock.calls
      .filter((call) => call[1]?.body)
      .map((call) => JSON.parse(call[1].body));
  const messagesTo = (phone) =>
    sentBodies()
      .filter((b) => b.recipients.includes(phone))
      .map((b) => b.message);
  const stationAlerts = () =>
    sentBodies().filter((b) => b.message.startsWith('SAKLOLO 161\nDISPATCH ALERT'));

  async function dispatchFlood(token, incidentId) {
    return request(app)
      .post('/api/incidents/dispatch')
      .set('Authorization', `Bearer ${token}`)
      .send({ incidentId, stationId: STATION_ID, assignedUnit: UNIT });
  }

  async function patchStatus(token, incidentId, status) {
    return request(app)
      .patch(`/api/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status });
  }

  async function waitForPublicStatus(incidentId, expected) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const res = await request(app).get(`/api/incidents/${incidentId}`);
      if (res.body?.data?.status === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`incident ${incidentId} never reached status "${expected}"`);
  }

  // SMS is enqueued fire-and-forget so the HTTP 200 does not wait on
  // TextBee. Poll until at least `n` TextBee submissions have started.
  async function waitForSubmissions(n, timeoutMs = 2000) {
    const start = Date.now();
    while (submissions.length < n) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `waitForSubmissions: expected >= ${n} submissions, saw ${submissions.length} after ${timeoutMs}ms`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it('dispatch followed by a racing En Route sends no SMS', async () => {
    const token = await loginAs('flood');

    // Fire the dispatch WITHOUT waiting, then play the web dashboard:
    // poll the public endpoint until the incident reads "Dispatched"
    // and click MARK EN ROUTE immediately — the sequence that used to
    // race two texts. Now neither step may text anyone.
    const dispatchReq = dispatchFlood(token, ids.order).then((res) => res);
    await waitForPublicStatus(ids.order, 'Dispatched');

    const patch = await patchStatus(token, ids.order, 'En Route');
    expect(patch.status).toBe(200);

    const dispatchRes = await dispatchReq;
    expect(dispatchRes.status).toBe(200);

    // Give any (incorrect) background SMS a moment to appear.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(submissions).toHaveLength(0);
    expect(messagesTo(ORDER_CITIZEN)).toHaveLength(0);
    expect(stationAlerts()).toHaveLength(0);
  });

  it('the creation confirmation is the only SMS when a dispatch follows', async () => {
    const created = await request(app)
      .post('/api/incidents')
      .send({ ...makeIncident('Flood'), citizenPhone: FRESH_CITIZEN });
    expect(created.status).toBe(201);
    await waitForSubmissions(1);

    const token = await loginAs('flood');
    const dispatchRes = await dispatchFlood(token, created.body.data.incidentId);
    expect(dispatchRes.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const msgs = messagesTo(FRESH_CITIZEN);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('has been received');
  });

  it('dispatch and En Route send no SMS at all', async () => {
    const token = await loginAs('flood');

    const dispatchRes = await dispatchFlood(token, ids.counts);
    expect(dispatchRes.status).toBe(200);

    const patch = await patchStatus(token, ids.counts, 'En Route');
    expect(patch.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(submissions).toHaveLength(0);
    expect(messagesTo(COUNTS_CITIZEN)).toHaveLength(0);
    expect(stationAlerts()).toHaveLength(0);
  });

  it('full lifecycle produces exactly two citizen SMS: confirmation then resolution', async () => {
    // Start/end-only policy: creation confirms, resolution closes, and
    // dispatch plus intermediate statuses stay silent — in order.
    const LIFECYCLE_CITIZEN = '+639170002011';
    const created = await request(app)
      .post('/api/incidents')
      .send({ ...makeIncident('Flood'), citizenPhone: LIFECYCLE_CITIZEN });
    expect(created.status).toBe(201);
    const incidentId = created.body.data.incidentId;
    await waitForSubmissions(1);

    const token = await loginAs('flood');
    const dispatchRes = await dispatchFlood(token, incidentId);
    expect(dispatchRes.status).toBe(200);

    const enRoute = await patchStatus(token, incidentId, 'En Route');
    expect(enRoute.status).toBe(200);

    const resolved = await patchStatus(token, incidentId, 'Resolved');
    expect(resolved.status).toBe(200);
    await waitForSubmissions(2);

    const citizenMsgs = messagesTo(LIFECYCLE_CITIZEN);
    expect(citizenMsgs).toHaveLength(2);
    expect(citizenMsgs[0]).toContain('has been received');
    expect(citizenMsgs[1]).toContain('INCIDENT RESOLVED');
    expect(citizenMsgs[1]).toContain(`Incident: ${incidentId}`);

    // No station text at any point in the lifecycle.
    expect(stationAlerts()).toHaveLength(0);
  });

  it('repeating the Resolved update sends no duplicate SMS but still returns 200', async () => {
    const token = await loginAs('flood');

    const first = await patchStatus(token, ids.sequencedup, 'Resolved');
    expect(first.status).toBe(200);
    await waitForSubmissions(1);
    expect(messagesTo(SEQUENCEDUP_CITIZEN)).toHaveLength(1);

    const second = await patchStatus(token, ids.sequencedup, 'Resolved');
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.data.status).toBe('Resolved');
    // Give any (incorrect) second send a moment to appear before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messagesTo(SEQUENCEDUP_CITIZEN)).toHaveLength(1);
  });

  it('two racing Resolved updates send exactly one SMS', async () => {
    const token = await loginAs('flood');
    const [a, b] = await Promise.all([
      patchStatus(token, ids.racedup, 'Resolved'),
      patchStatus(token, ids.racedup, 'Resolved'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.status).toBe('Resolved');
    expect(b.body.data.status).toBe('Resolved');
    await waitForSubmissions(1);
    expect(messagesTo(RACEDUP_CITIZEN)).toHaveLength(1);
  });

  it('a transient SMS-construction failure fails the PATCH without writing or claiming, and the retry announces', async () => {
    const token = await loginAs('flood');

    // Make message construction blow up on the FIRST attempt only, by
    // handing the handler a record whose incidentId read throws inside
    // buildStatusSms(). The copy keeps the mock store pristine.
    const originalFindById = incidentServiceCjs.findById;
    vi.spyOn(incidentServiceCjs, 'findById').mockImplementationOnce(
      async (id) => {
        const inc = { ...(await originalFindById(id)) };
        Object.defineProperty(inc, 'incidentId', {
          get() {
            throw new Error('simulated construction failure');
          },
        });
        return inc;
      }
    );

    const fail = await patchStatus(token, ids.buildfail, 'Resolved');
    expect(fail.status).toBe(500);
    expect(messagesTo(BUILDFAIL_CITIZEN)).toHaveLength(0);

    // The failed attempt changed nothing: status still Pending, so the
    // retry is a genuine transition again — not a suppressed no-op.
    const unchanged = await request(app).get(`/api/incidents/${ids.buildfail}`);
    expect(unchanged.body.data.status).toBe('Pending');

    const retry = await patchStatus(token, ids.buildfail, 'Resolved');
    expect(retry.status).toBe(200);
    await waitForSubmissions(1);
    expect(
      messagesTo(BUILDFAIL_CITIZEN).filter((m) => m.includes('INCIDENT RESOLVED'))
    ).toHaveLength(1);

    // Further repeats stay deduplicated — the retry consumed the claim.
    const third = await patchStatus(token, ids.buildfail, 'Resolved');
    expect(third.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messagesTo(BUILDFAIL_CITIZEN)).toHaveLength(1);
  });

  it('two concurrent intermediate status updates send no SMS', async () => {
    const token = await loginAs('flood');
    const [a, b] = await Promise.all([
      patchStatus(token, ids.concurrent, 'Dispatched'),
      patchStatus(token, ids.concurrent, 'En Route'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    // Both transitions are recorded without texting anyone.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(submissions).toHaveLength(0);
    expect(messagesTo(CONCURRENT_CITIZEN)).toHaveLength(0);
  });

  it('dispatch followed by a Dispatched PATCH sends no SMS', async () => {
    const token = await loginAs('flood');
    const dispatchRes = await dispatchFlood(token, ids.nodup);
    expect(dispatchRes.status).toBe(200);

    const patch = await patchStatus(token, ids.nodup, 'Dispatched');
    expect(patch.status).toBe(200);
    expect(patch.body.data.status).toBe('Dispatched');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(submissions).toHaveLength(0);
    expect(messagesTo(NODEDUP_CITIZEN)).toHaveLength(0);
  });

  it('a TextBee timeout never fails the dispatch and the ordered queue keeps flowing', async () => {
    mode = 'timeout';
    const token = await loginAs('flood');

    const dispatchRes = await dispatchFlood(token, ids.timeout);
    expect(dispatchRes.status).toBe(200);
    expect(dispatchRes.body.success).toBe(true);
    expect(dispatchRes.body.data.status).toBe('Dispatched');
    // Dispatch sends nothing, so the timeout mode changes nothing here.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(submissions).toHaveLength(0);

    // The resolution still hands its SMS to TextBee once the provider
    // recovers — the failed mode must not wedge the chain.
    mode = 'ok';
    const patch = await patchStatus(token, ids.timeout, 'Resolved');
    expect(patch.status).toBe(200);
    expect(patch.body.data.status).toBe('Resolved');
    await waitForSubmissions(1);
    expect(messagesTo(TIMEOUT_CITIZEN).filter((m) => m.includes('INCIDENT RESOLVED'))).toHaveLength(1);
  });

  it('a TextBee HTTP 500 never fails a status update', async () => {
    mode = 'http500';
    const token = await loginAs('flood');

    const patch = await patchStatus(token, ids.httpfail, 'Resolved');
    expect(patch.status).toBe(200);
    expect(patch.body.success).toBe(true);
    expect(patch.body.data.status).toBe('Resolved');
    await waitForSubmissions(1);
    // The send was ATTEMPTED and its failure swallowed — not dropped silently.
    expect(messagesTo(HTTPFAIL_CITIZEN).filter((m) => m.includes('INCIDENT RESOLVED'))).toHaveLength(1);
  });

  it('HTTP responses return without waiting on a slow TextBee round-trip', async () => {
    // Absolute wall-clock budgets are unreliable here: CI contract tests
    // run against live Firebase RTDB, and findById+updateStatus alone can
    // exceed several hundred ms. The real property is that the HTTP path
    // never awaits the SMS job — so TextBee is gated shut instead: if the
    // PATCH awaited the resolution send, this request would deadlock on
    // the closed gate (vitest timeout) instead of returning 200.
    const token = await loginAs('flood');
    const created = await request(app)
      .post('/api/incidents')
      .send({ ...makeIncident('Flood'), citizenPhone: '+639170002012' });
    expect(created.status).toBe(201);
    const incidentId = created.body.data.incidentId;
    await waitForSubmissions(1);

    let releaseTextbee;
    textbeeGate = new Promise((resolve) => {
      releaseTextbee = resolve;
    });
    mode = 'gated';

    const patch = await patchStatus(token, incidentId, 'Resolved');
    expect(patch.status).toBe(200);
    expect(patch.body.data.status).toBe('Resolved');

    // Gate still closed: the 200 returned while TextBee was hung.
    releaseTextbee();
    await waitForSubmissions(2);
    expect(
      messagesTo('+639170002012').filter((m) => m.includes('INCIDENT RESOLVED'))
    ).toHaveLength(1);
  });

  it('a stuck TextBee send on one incident does not block another incident', async () => {
    // Gate ONLY the first incident's citizen SMS. The second incident's
    // chain is independent, so its SMS must still reach TextBee while
    // the first is stuck — without any absolute time limit (live
    // Firebase latency varies by runner and must not fail this test).
    let releaseOrderSms;
    textbeeGate = new Promise((resolve) => {
      releaseOrderSms = resolve;
    });
    textbeeGatePhone = ORDER_CITIZEN;
    mode = 'gated';
    const token = await loginAs('flood');

    const [a, b] = await Promise.all([
      patchStatus(token, ids.order, 'Resolved'),
      patchStatus(token, ids.counts, 'Resolved'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const completedTo = (phone) =>
      submissions
        .filter((s) => s.completed && s.recipients.includes(phone))
        .map((s) => s.message);

    // B's SMS completes while A's is still gated at the provider.
    for (let attempt = 0; attempt < 200; attempt++) {
      if (completedTo(COUNTS_CITIZEN).some((m) => m.includes('Status: Resolved'))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(
      completedTo(COUNTS_CITIZEN).filter((m) => m.includes('Status: Resolved'))
    ).toHaveLength(1);
    // A's fetch was called (submission recorded) but the gateway call
    // has not completed — it is still sitting on the closed gate.
    expect(
      completedTo(ORDER_CITIZEN).filter((m) => m.includes('Status: Resolved'))
    ).toHaveLength(0);
    expect(
      messagesTo(ORDER_CITIZEN).filter((m) => m.includes('Status: Resolved'))
    ).toHaveLength(1);

    releaseOrderSms();
    for (let attempt = 0; attempt < 200; attempt++) {
      if (completedTo(ORDER_CITIZEN).some((m) => m.includes('Status: Resolved'))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(
      completedTo(ORDER_CITIZEN).filter((m) => m.includes('Status: Resolved'))
    ).toHaveLength(1);
  });
});

describe('POST /api/incidents/:id/evidence', () => {
  let incidentId;
  let uploadedFileId;

  beforeAll(async () => {
    const created = await request(app).post('/api/incidents').send(makeIncident());
    incidentId = created.body.data.incidentId;
  });

  it('accepts a small file and returns the contract record', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/evidence`)
      .attach('file', Buffer.from('fake image bytes'), 'evidence.jpg');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.fileId).toMatch(/^ev-/);
    expect(typeof d.url).toBe('string');
    // url is a relative media path so clients resolve it against their
    // own API base (LAN phone / TLS web) — never a baked host.
    expect(d.url).toBe(`/api/incidents/${incidentId}/evidence/${d.fileId}/media`);
    expect(typeof d.mimeType).toBe('string');
    expect(typeof d.sizeKb).toBe('number');
    expect(new Date(d.uploadedAt).toString()).not.toBe('Invalid Date');
    uploadedFileId = d.fileId;
  });

  it('appends the evidence to the incident detail', async () => {
    const res = await request(app).get(`/api/incidents/${incidentId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.evidence.length).toBeGreaterThan(0);
    expect(res.body.data.evidence[0].fileId).toMatch(/^ev-/);
  });

  it('400s when no file is attached', async () => {
    const res = await request(app).post(`/api/incidents/${incidentId}/evidence`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('404s for an unknown incident', async () => {
    const res = await request(app)
      .post('/api/incidents/INC-99999999-9999/evidence')
      .attach('file', Buffer.from('x'), 'x.jpg');
    expect(res.status).toBe(404);
  });

  it('400s for files over the 200 MB limit', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/evidence`)
      .attach('file', Buffer.alloc(201 * 1024 * 1024), 'big.bin');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('streams the stored media with the record content type', async () => {
    const res = await request(app).get(
      `/api/incidents/${incidentId}/evidence/${uploadedFileId}/media`
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.isBuffer(res.body) || typeof res.body === 'object').toBe(true);
  });

  it('404s for an unknown evidence fileId', async () => {
    const res = await request(app).get(
      `/api/incidents/${incidentId}/evidence/ev-does-not-exist/media`
    );
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('sendSms (TextBee)', () => {
  const ORIGINAL_KEY = env.TEXTBEE_API_KEY;
  const TEST_KEY = 'test-key-contract-suite';
  const TEXTBEE_URL = 'https://api.textbee.dev/api/v1/gateway/send-sms';
  const TEXTBEE_BODY = { recipients: ['+639171234567'], message: 'Help is on the way.' };
  const TEXTBEE_SUCCESS = {
    data: {
      success: true,
      message: 'SMS added to queue for processing',
      smsBatchId: '66b1f2c3a4d5e6f7a8b9c0d2',
      recipientCount: 1,
    },
  };
  let fetchSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy.mockClear();
    // Failure-path tests below exercise console.error logging; scope the
    // silencing to THIS block so unrelated server errors stay visible.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    env.TEXTBEE_API_KEY = TEST_KEY;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    env.TEXTBEE_API_KEY = ORIGINAL_KEY;
  });

  it('skips without calling fetch when the API key is missing', async () => {
    env.TEXTBEE_API_KEY = '';

    const result = await textbeeService.sendSms('+639171234567', 'Help is on the way.');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.mock).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.message).toContain('API key is not configured');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('API key is not configured');
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it('POSTs the expected payload to the TextBee endpoint on success', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TEXTBEE_SUCCESS,
    });

    const result = await textbeeService.sendSms('+639171234567', 'Help is on the way.');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(TEXTBEE_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    // TextBee auth: the key travels in the x-api-key HEADER only…
    expect(init.headers['x-api-key']).toBe(TEST_KEY);
    // …and must never appear in the JSON body (which is sent in clear).
    const sentBody = JSON.parse(init.body);
    expect(init.body).not.toContain(TEST_KEY);
    // Request budget: AbortSignal.timeout() must be attached (Node 20).
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Body contract: recipients array + message, no sendername, no deviceId
    // unless TEXTBEE_DEVICE_ID is configured (it isn't here).
    expect(sentBody).toEqual(TEXTBEE_BODY);
    expect(sentBody).not.toHaveProperty('apikey');
    expect(sentBody).not.toHaveProperty('sendername');
    expect(sentBody).not.toHaveProperty('deviceId');

    expect(result.success).toBe(true);
    expect(result.mock).toBe(false);
    expect(result.data).toEqual(TEXTBEE_SUCCESS);
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it('parses TextBee\'s nested success response ({ data: { success, smsBatchId } })', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TEXTBEE_SUCCESS,
    });

    const result = await textbeeService.sendSms('+639171234567', 'Help is on the way.');

    expect(result.success).toBe(true);
    // 200 from TextBee means accepted/queued — not guaranteed delivery.
    // result.data is the raw parsed body, which nests success under `data`.
    expect(result.data.data.success).toBe(true);
    expect(result.data.data.smsBatchId).toBe('66b1f2c3a4d5e6f7a8b9c0d2');
    expect(result.data.data.recipientCount).toBe(1);
  });

  it('includes deviceId in the body only when TEXTBEE_DEVICE_ID is set', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TEXTBEE_SUCCESS,
    });
    env.TEXTBEE_DEVICE_ID = 'device-123';

    try {
      await textbeeService.sendSms('+639171234567', 'Help is on the way.');
      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(sentBody.deviceId).toBe('device-123');
      expect(sentBody.recipients).toEqual(['+639171234567']);
    } finally {
      env.TEXTBEE_DEVICE_ID = '';
    }
  });

  it('resolves safely on a non-2xx TextBee response (400 — no online device)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'No enabled device to send from' }),
    });

    // Awaiting directly is the assertion: sendSms() must resolve, never reject.
    const result = await textbeeService.sendSms('161', 'DISPATCH alert');
    expect(result).toBeDefined();

    expect(result.success).toBe(false);
    expect(result.mock).toBe(false);
    expect(result.message).toContain('400');
    expect(result.error.status).toBe(400);
  });

  it('resolves safely on a 401 (missing/invalid/revoked API key)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });

    // Awaiting directly is the assertion: sendSms() must resolve, never reject.
    const result = await textbeeService.sendSms('+639171234567', 'Help is on the way.');
    expect(result).toBeDefined();

    expect(result.success).toBe(false);
    expect(result.mock).toBe(false);
    expect(result.message).toContain('401');
    expect(result.error.status).toBe(401);
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it('resolves safely on a network/fetch failure', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    // Awaiting directly is the assertion: sendSms() must resolve, never reject.
    const result = await textbeeService.sendSms('+639171234567', 'Help is on the way.');
    expect(result).toBeDefined();

    expect(result.success).toBe(false);
    expect(result.mock).toBe(false);
    expect(result.error).toContain('network down');
  });

  it('resolves safely on a timeout', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    fetchSpy.mockRejectedValue(timeoutError);

    // Awaiting directly is the assertion: sendSms() must resolve, never reject.
    const result = await textbeeService.sendSms('+639171234567', 'Help is on the way.');
    expect(result).toBeDefined();

    expect(result.success).toBe(false);
    expect(result.mock).toBe(false);
    expect(result.message.toLowerCase()).toContain('timed out');
  });

  it('resolves safely when the response body is not valid JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });

    // Awaiting directly is the assertion: sendSms() must resolve, never reject.
    const result = await textbeeService.sendSms('+639171234567', 'Help is on the way.');
    expect(result).toBeDefined();

    expect(result.success).toBe(false);
    expect(result.mock).toBe(false);
    expect(result.message.toLowerCase()).toContain('json');
  });
});
