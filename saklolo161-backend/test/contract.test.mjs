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
    // citizen SMS and mobile tracker show driving time, not readiness.
    expect(res.body.data.dispatch).toBeTruthy();
    expect(Number.isInteger(res.body.data.dispatch.arrivalEtaMinutes)).toBe(true);
    expect(res.body.data.dispatch.arrivalEtaMinutes).toBeGreaterThanOrEqual(1);

    // AND it must be visible on the public detail endpoint too.
    const detail = await request(app).get(`/api/incidents/${incidentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.station.coords.lat).toBe(14.635687529310072);
    expect(detail.body.data.station.coords.lng).toBe(121.09384592111986);
  });

  it('texts the citizen a real arrival ETA (fetch stubbed — no real SMS)', async () => {
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

    // Stub fetch + configure a throwaway key so sendSms() actually
    // builds the TextBee request — the assertion below inspects the
    // request body instead of the old "[MOCK SMS]" console line, and
    // no network call leaves the process.
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

      expect(fetchSpy).toHaveBeenCalled();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
      expect(init.method).toBe('POST');

      const smsBodies = fetchSpy.mock.calls.map((call) => JSON.parse(call[1].body));
      const citizenSms = smsBodies.find((b) => b.recipients.includes('+639121987654'));
      expect(citizenSms).toBeTruthy();
      expect(citizenSms.message).toContain(`Arrival ETA: ~${expectedMin} min`);
      expect(citizenSms.message).not.toContain('ETA: 2–5 mins');
    } finally {
      vi.unstubAllGlobals();
      env.TEXTBEE_API_KEY = '';
    }
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
