/**
 * test/userAdmin.test.mjs
 * --------------------------------------------------------------
 * HTTP tests for the admin user-management surface
 * (GET/POST/PATCH /api/users, PATCH /api/users/:uid/status).
 *
 * Unlike contract.test.mjs (real Firebase), these tests MOCK every
 * Firebase Admin Auth operation — user-management unit/HTTP coverage
 * must not touch (or depend on) the real Firebase project.
 *
 * Mock mechanism: server.js runs as native CommonJS, so vitest's
 * vi.mock() cannot intercept its internal require() calls. Instead
 * these tests patch the shared require-cache instances directly
 * (via createRequire) and restore them in afterAll():
 *   - authService.verifyToken  → decodes the fake admin/dispatcher
 *     tokens (verifyAuth itself still runs for real).
 *   - config/firebase.getFirebaseAuth → returns the mocked auth
 *     object used by userService.
 * The 401/403 boundary is therefore exercised end-to-end through
 * the actual middleware chain.
 * --------------------------------------------------------------
 */

import request from 'supertest';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import app from '../server.js';

// The same module instances server.js's middleware chain uses
// (native require cache — see header).
const nativeRequire = createRequire(import.meta.url);
const authServiceNative = nativeRequire('../services/authService.js');
const firebaseNative = nativeRequire('../config/firebase.js');

const originalVerifyToken = authServiceNative.verifyToken;
const originalGetFirebaseAuth = firebaseNative.getFirebaseAuth;

const mockAuth = {
  listUsers: vi.fn(),
  createUser: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
  revokeRefreshTokens: vi.fn(),
};

const ADMIN_TOKEN = 'admin-token';
const DISPATCHER_TOKEN = 'dispatcher-token';

const adminAuth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const dispatcherAuth = { Authorization: `Bearer ${DISPATCHER_TOKEN}` };

beforeAll(() => {
  // Fake Firebase ID tokens → the frozen { uid, email, agency, role }
  // payload buildPayload() would produce.
  authServiceNative.verifyToken = vi.fn(async (token) => {
    if (token === ADMIN_TOKEN) {
      return {
        uid: 'uid-admin',
        email: 'admin@marikina.gov.ph',
        agency: 'ALL',
        role: 'admin',
      };
    }
    if (token === DISPATCHER_TOKEN) {
      return {
        uid: 'uid-fire',
        email: 'fire@marikina.gov.ph',
        agency: 'FIRE',
        role: 'dispatcher',
      };
    }
    throw new Error('Invalid or expired token.');
  });

  firebaseNative.getFirebaseAuth = () => mockAuth;
});

afterAll(() => {
  authServiceNative.verifyToken = originalVerifyToken;
  firebaseNative.getFirebaseAuth = originalGetFirebaseAuth;
});

// Two provisioned Firebase users as listUsers() would return them:
// claims attached, no passwords (Firebase never returns those).
const FIREBASE_USER_RECORDS = [
  {
    uid: 'uid-admin',
    email: 'admin@marikina.gov.ph',
    disabled: false,
    metadata: { creationTime: 'Mon, 01 Jan 2026 00:00:00 GMT' },
    customClaims: { agency: 'ALL', role: 'admin' },
  },
  {
    uid: 'uid-fire',
    email: 'fire@marikina.gov.ph',
    disabled: true,
    metadata: { creationTime: 'Tue, 02 Jan 2026 00:00:00 GMT' },
    customClaims: { agency: 'FIRE', role: 'dispatcher' },
  },
];

function recordFor(uid) {
  return (
    records.find((u) => u.uid === uid) ?? {
      uid,
      email: `${uid}@marikina.gov.ph`,
      disabled: false,
      metadata: { creationTime: 'Wed, 03 Jan 2026 00:00:00 GMT' },
      customClaims: { agency: 'ALL', role: 'dispatcher' },
    }
  );
}

let records;

beforeEach(() => {
  vi.clearAllMocks();

  // Fresh copies each test so applied mutations can't leak across cases.
  records = structuredClone(FIREBASE_USER_RECORDS);

  mockAuth.listUsers.mockResolvedValue({ users: records });
  mockAuth.createUser.mockResolvedValue({ uid: 'uid-new' });
  mockAuth.getUser.mockImplementation(async (uid) => recordFor(uid));
  // Apply mutations the way Firebase would, so response assertions
  // (which re-fetch the record) see the updated state.
  mockAuth.updateUser.mockImplementation(async (uid, changes) => {
    Object.assign(recordFor(uid), changes);
  });
  mockAuth.setCustomUserClaims.mockImplementation(async (uid, claims) => {
    recordFor(uid).customClaims = { ...claims };
  });
  mockAuth.revokeRefreshTokens.mockResolvedValue(undefined);
});

describe('GET /api/users — auth boundary', () => {
  it('1. returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('2. returns 401 for an invalid token', async () => {
    const res = await request(app)
      .get('/api/users')
      .set({ Authorization: 'Bearer garbage-token' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('3. returns 403 for an authenticated dispatcher (non-admin)', async () => {
    const res = await request(app).get('/api/users').set(dispatcherAuth);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe('string');
    // 403 is an authorization failure, not an authentication failure:
    // it must NOT fall through to the 401/logout path.
    expect(res.status).not.toBe(401);
    expect(mockAuth.listUsers).not.toHaveBeenCalled();
  });

  it('4. returns 200 for an authenticated admin', async () => {
    const res = await request(app).get('/api/users').set(adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/users — payload shape', () => {
  it('5. returns mapped users (uid, email, agency, role, disabled, createdAt)', async () => {
    const res = await request(app).get('/api/users').set(adminAuth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);

    const [first, second] = res.body.data;
    expect(first).toEqual({
      uid: 'uid-admin',
      email: 'admin@marikina.gov.ph',
      agency: 'ALL',
      role: 'admin',
      disabled: false,
      createdAt: 'Mon, 01 Jan 2026 00:00:00 GMT',
    });
    expect(second.disabled).toBe(true);
    expect(second.role).toBe('dispatcher');
  });

  it('6. returns no password/hash/token fields anywhere in the response', async () => {
    const res = await request(app).get('/api/users').set(adminAuth);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/password/i);
    expect(raw).not.toMatch(/passwordHash/i);
    expect(raw).not.toMatch(/refreshToken/i);
    expect(raw).not.toMatch(/serviceAccount/i);
    for (const user of res.body.data) {
      expect(Object.keys(user).sort()).toEqual([
        'agency',
        'createdAt',
        'disabled',
        'email',
        'role',
        'uid',
      ]);
    }
  });
});

describe('POST /api/users — validation', () => {
  const validBody = {
    email: 'new@marikina.gov.ph',
    password: 'secret123',
    agency: 'FLOOD',
    role: 'dispatcher',
  };

  it('7. rejects an invalid agency with 400 and does not touch Firebase', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(adminAuth)
      .send({ ...validBody, agency: 'PLUMBING' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockAuth.createUser).not.toHaveBeenCalled();
    expect(mockAuth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('8. rejects an invalid role with 400 and does not touch Firebase', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(adminAuth)
      .send({ ...validBody, role: 'superuser' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockAuth.createUser).not.toHaveBeenCalled();
  });

  it('rejects a missing email or password with 400', async () => {
    const noEmail = await request(app)
      .post('/api/users')
      .set(adminAuth)
      .send({ ...validBody, email: '' });
    expect(noEmail.status).toBe(400);

    const noPassword = await request(app)
      .post('/api/users')
      .set(adminAuth)
      .send({ ...validBody, password: '' });
    expect(noPassword.status).toBe(400);
    expect(mockAuth.createUser).not.toHaveBeenCalled();
  });

  it('7b. returns 403 when a dispatcher attempts to create a user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(dispatcherAuth)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(mockAuth.createUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/users — creation', () => {
  const validBody = {
    email: 'new@marikina.gov.ph',
    password: 'secret123',
    agency: 'FLOOD',
    role: 'dispatcher',
  };

  it('9. creates the Firebase user with email + password', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(adminAuth)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockAuth.createUser).toHaveBeenCalledTimes(1);
    expect(mockAuth.createUser).toHaveBeenCalledWith({
      email: 'new@marikina.gov.ph',
      password: 'secret123',
    });
  });

  it('10. sets the { agency, role } custom claims on the new user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(adminAuth)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledTimes(1);
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('uid-new', {
      agency: 'FLOOD',
      role: 'dispatcher',
    });
    expect(res.body.data.uid).toBe('uid-new');
  });

  it('11. the create response never contains the password', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(adminAuth)
      .send(validBody);
    expect(res.status).toBe(201);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('secret123');
    expect(raw).not.toMatch(/password/i);
  });

  it('maps Firebase duplicate-email errors to 400 without leaking internals', async () => {
    mockAuth.createUser.mockRejectedValue(
      Object.assign(new Error('Firebase internal details here.'), {
        code: 'auth/email-already-exists',
      })
    );
    const res = await request(app)
      .post('/api/users')
      .set(adminAuth)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).not.toContain('Firebase internal');
  });
});

describe('PATCH /api/users/:uid — updates', () => {
  it('12. updates the email when supplied', async () => {
    const res = await request(app)
      .patch('/api/users/uid-admin')
      .set(adminAuth)
      .send({ email: 'renamed@marikina.gov.ph' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockAuth.updateUser).toHaveBeenCalledWith('uid-admin', {
      email: 'renamed@marikina.gov.ph',
    });
    // Email-only update must not rewrite claims.
    expect(mockAuth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('13. updates agency/role custom claims when supplied', async () => {
    const res = await request(app)
      .patch('/api/users/uid-admin')
      .set(adminAuth)
      .send({ agency: 'MEDICAL', role: 'admin' });
    expect(res.status).toBe(200);
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('uid-admin', {
      agency: 'MEDICAL',
      role: 'admin',
    });
    expect(res.body.data.agency).toBe('MEDICAL');
    expect(res.body.data.role).toBe('admin');
  });

  it('preserves unclaimed fields when updating only one claim', async () => {
    const res = await request(app)
      .patch('/api/users/uid-fire')
      .set(adminAuth)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    // uid-fire's existing claims carry agency: FIRE — must survive.
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('uid-fire', {
      agency: 'FIRE',
      role: 'admin',
    });
  });

  it('returns 404 for an unknown uid', async () => {
    mockAuth.getUser.mockRejectedValue(
      Object.assign(new Error('There is no user record.'), {
        code: 'auth/user-not-found',
      })
    );
    const res = await request(app)
      .patch('/api/users/uid-missing')
      .set(adminAuth)
      .send({ agency: 'FLOOD' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 for a dispatcher', async () => {
    const res = await request(app)
      .patch('/api/users/uid-admin')
      .set(dispatcherAuth)
      .send({ agency: 'FLOOD' });
    expect(res.status).toBe(403);
    expect(mockAuth.updateUser).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/users/:uid/status — disable/enable', () => {
  it('14. disabling sets disabled: true and revokes refresh tokens', async () => {
    const res = await request(app)
      .patch('/api/users/uid-fire/status')
      .set(adminAuth)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockAuth.updateUser).toHaveBeenCalledWith('uid-fire', {
      disabled: true,
    });
    expect(mockAuth.revokeRefreshTokens).toHaveBeenCalledWith('uid-fire');
  });

  it('15. enabling sets disabled: false without revoking tokens', async () => {
    const res = await request(app)
      .patch('/api/users/uid-fire/status')
      .set(adminAuth)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockAuth.updateUser).toHaveBeenCalledWith('uid-fire', {
      disabled: false,
    });
    expect(mockAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean enabled value with 400', async () => {
    const res = await request(app)
      .patch('/api/users/uid-fire/status')
      .set(adminAuth)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockAuth.updateUser).not.toHaveBeenCalled();
  });

  it('returns 403 for a dispatcher', async () => {
    const res = await request(app)
      .patch('/api/users/uid-fire/status')
      .set(dispatcherAuth)
      .send({ enabled: false });
    expect(res.status).toBe(403);
    expect(mockAuth.updateUser).not.toHaveBeenCalled();
    expect(mockAuth.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/users/:uid', () => {
  it('16. does not exist — returns 404', async () => {
    const res = await request(app)
      .delete('/api/users/uid-admin')
      .set(adminAuth);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(mockAuth.deleteUser).toBeUndefined();
  });
});
