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
 *   POST /api/incidents/dispatch      → top-level `station.coords`
 *   Auth boundary                      → list requires token, :id does not
 * --------------------------------------------------------------
 */

import request from 'supertest';
import { describe, it, expect, beforeAll } from 'vitest';

// Must be imported BEFORE the app: blanks MAPBOX_ACCESS_TOKEN before
// config/env.js loads, so routing deterministically takes the
// straight-line fallback in the suite (no network in CI). Live
// Mapbox behavior is verified separately via smoke test.
import './blank-mapbox.mjs';

import app from '../server.js';

const MOCK_PASSWORD = 'changeme123';

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
  it('validates the four numeric params', async () => {
    const res = await request(app).get('/api/routes').query({ fromLat: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
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
  it('is public and always includes an evidence array', async () => {
    const res = await request(app).get('/api/incidents/INC-20250811-0001');
    expect(res.status).toBe(200);
    expect(res.body.data.incidentId).toBe('INC-20250811-0001');
    expect(Array.isArray(res.body.data.evidence)).toBe(true);
  });

  it('404s on an unknown id', async () => {
    const res = await request(app).get('/api/incidents/INC-99999999-9999');
    expect(res.status).toBe(404);
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
        assignedUnit: 'River Rescue Boat 1',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Dispatched');
    expect(res.body.data.station).toBeTruthy();
    expect(res.body.data.station.id).toBe('FLOOD_RIVER_COMMAND');
    expect(res.body.data.station.name).toBeTruthy();
    expect(res.body.data.station.coords).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });

    // AND it must be visible on the public detail endpoint too.
    const detail = await request(app).get(`/api/incidents/${incidentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.station.coords.lat).toBe(14.611);
    expect(detail.body.data.station.coords.lng).toBe(121.103);
  });
});

describe('POST /api/incidents/:id/evidence', () => {
  let incidentId;

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
    expect(typeof d.mimeType).toBe('string');
    expect(typeof d.sizeKb).toBe('number');
    expect(new Date(d.uploadedAt).toString()).not.toBe('Invalid Date');
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

  it('400s for files over the 10 MB limit', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/evidence`)
      .attach('file', Buffer.alloc(11 * 1024 * 1024), 'big.bin');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});