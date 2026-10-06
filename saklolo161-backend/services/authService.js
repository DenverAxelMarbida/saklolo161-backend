/**
 * services/authService.js
 * --------------------------------------------------------------
 * Abstraction layer over "how staff credentials are validated and
 * how tokens are issued/verified". Controllers and middleware NEVER
 * import firebase-admin, axios, or the Auth REST API directly — they
 * only call the functions exported here. That's what kept the
 * Phase 3 Firebase Auth cutover a one-file change: the internals
 * below swapped (bcrypt/jsonwebtoken/mockUsers → Firebase Auth),
 * the interface and payload contract did not.
 *
 * Frozen payload contract (see ../Phase 3/saklolo161-phase3-
 * contracts.md): every resolved user is EXACTLY
 * { uid, email, agency, role } — agency/role come from Firebase
 * custom claims set at provisioning time (scripts/provisionUser.js).
 *
 * Modeled on services/stationService.js: same "one service file
 * the rest of the app depends on, never the underlying library/
 * store directly" philosophy.
 * --------------------------------------------------------------
 */

const axios = require('axios');
const { FIREBASE_WEB_API_KEY } = require('../config/env');
const { getFirebaseAuth } = require('../config/firebase');

const AUTH_REST_TIMEOUT_MS = 10000;

/**
 * Maps a decoded Firebase ID token (custom claims included) to the
 * frozen payload shape. Rejects tokens missing the claims the
 * authorization layer depends on, so verifyAuth responds 401 instead
 * of a controller crashing on `agency.toLowerCase()` of undefined.
 *
 * @param {object} decoded result of admin.auth().verifyIdToken()
 * @returns {{ uid: string, email: string|undefined, agency: string, role: string }}
 * @throws If uid, agency, or role is missing.
 */
function buildPayload(decoded) {
  const { uid, email, agency, role } = decoded;

  if (!uid || !agency || !role) {
    throw new Error('Token is missing required claims (agency, role).');
  }

  return { uid, email, agency, role };
}

/**
 * Validates a dispatcher/admin's email + password against Firebase
 * Authentication (Auth REST `accounts:signInWithPassword`) and
 * returns the freshly issued Firebase ID token plus its payload.
 *
 * Preserves the POST /api/auth/login contract:
 *   200 { success, data: { token, user: { uid, email, agency, role } } }
 * Failures throw a generic 'Invalid email or password.' (never
 * leaking whether the email or the password was the wrong part),
 * matching the Phase 2 behavior; a missing/unconfigured API key or
 * an unreachable Auth service surfaces as its own message.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ token: string, user: { uid, email, agency, role } }>}
 */
async function login(email, password) {
  if (!FIREBASE_WEB_API_KEY) {
    throw new Error(
      'Firebase Auth login is not configured (missing FIREBASE_WEB_API_KEY).'
    );
  }

  let idToken;
  try {
    const res = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`,
      { email, password, returnSecureToken: true },
      { timeout: AUTH_REST_TIMEOUT_MS }
    );
    idToken = res.data.idToken;
  } catch (err) {
    const status = err.response && err.response.status;
    if (status >= 400 && status < 500) {
      // INVALID_PASSWORD / EMAIL_NOT_FOUND / INVALID_EMAIL all
      // collapse to the same generic message (Phase 2 behavior).
      throw new Error('Invalid email or password.');
    }
    throw new Error('Authentication service unavailable.');
  }

  // Verify the issued token so login returns exactly what
  // verifyToken() would resolve later — and fail loudly here if the
  // account was provisioned without { agency, role } claims.
  const decoded = await getFirebaseAuth().verifyIdToken(idToken);
  return { token: idToken, user: buildPayload(decoded) };
}

/**
 * Verifies a Firebase ID token, returning its frozen payload.
 *
 * @param {string} token Firebase ID token (Bearer header value)
 * @returns {Promise<{ uid, email, agency, role }>}
 * @throws If the token is invalid/expired or lacks the required
 *         claims — the caller (verifyAuth middleware) turns this
 *         into a 401. Legacy Phase 2 JWTs throw here too, which is
 *         the intended forced-re-login behavior.
 */
async function verifyToken(token) {
  const decoded = await getFirebaseAuth().verifyIdToken(token);
  return buildPayload(decoded);
}

/**
 * Verifies that `password` is the CURRENT password for `email`
 * against Firebase Auth (Auth REST `accounts:signInWithPassword` —
 * the exact credential check `reauthenticateWithCredential` performs
 * client-side). Used by the self-service change-password flow to
 * honor Firebase's recent-authentication requirement without ever
 * bypassing it: the caller proves the current password first, then
 * the Admin SDK applies the new one.
 *
 * Additive export — `login`/`verifyToken` contracts untouched.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<boolean>} true when the credentials are valid.
 * @throws When the API key is missing/unconfigured or the Auth
 *         service is unreachable (5xx/network) — the caller maps
 *         this to a generic 500, never to "wrong password".
 */
async function verifyPassword(email, password) {
  if (!FIREBASE_WEB_API_KEY) {
    throw new Error(
      'Firebase Auth verification is not configured (missing FIREBASE_WEB_API_KEY).'
    );
  }

  try {
    await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`,
      { email, password, returnSecureToken: true },
      { timeout: AUTH_REST_TIMEOUT_MS }
    );
    return true;
  } catch (err) {
    const status = err.response && err.response.status;
    if (status >= 400 && status < 500) {
      // Wrong email/password (or disabled account) — false, never leaked.
      return false;
    }
    throw new Error('Authentication service unavailable.');
  }
}

module.exports = { login, verifyToken, verifyPassword };
