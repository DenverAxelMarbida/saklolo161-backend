/**
 * services/authService.js
 * --------------------------------------------------------------
 * Abstraction layer over "how staff credentials are validated and
 * how tokens are issued/verified". Controllers and middleware NEVER
 * import mockUsers, bcryptjs, or jsonwebtoken directly — they only
 * call the functions exported here. That's what makes the Phase 3
 * Firebase Auth migration a one-file change: swap the internals
 * below, and nothing else in the codebase needs to know.
 *
 * See the PHASE 3 MIGRATION NOTE under each function for exactly
 * what changes when Firebase Auth is wired up.
 *
 * Modeled on services/stationService.js: same "one service file
 * the rest of the app depends on, never the underlying library/
 * store directly" philosophy.
 * --------------------------------------------------------------
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mockUsers = require('../data/mockUsers');
const { JWT_SECRET } = require('../config/env');

const TOKEN_TTL = '8h'; // one dispatcher shift

/**
 * Validates a dispatcher/admin's email + password and issues a JWT.
 *
 * PHASE 3 MIGRATION NOTE:
 * When Firebase Auth is wired up, this function gets replaced with a
 * call to Firebase's admin sign-in flow (admin.auth().getUserByEmail()
 * + a password check, or the SDK's signInWithPassword equivalent), or
 * is dropped entirely if login moves client-side to the Firebase SDK.
 * Because every other file calls authService.login() rather than
 * bcrypt/mockUsers directly, no other file needs to change.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ token: string, user: { uid, email, agency, role } }>}
 */
async function login(email, password) {
  const user = mockUsers.findByEmail(email);

  // Generic failure — never leak whether the email or the password was
  // the wrong part.
  const fail = () => {
    throw new Error('Invalid email or password.');
  };

  if (!user) fail();

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) fail();

  // Payload shape is intentionally { uid, email, agency, role } to match
  // what Firebase ID-token custom claims would look like later, so client
  // code (web + mobile) doesn't need to change in Phase 3.
  const payload = {
    uid: user.uid,
    email: user.email,
    agency: user.agency,
    role: user.role,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });

  return { token, user: payload };
}

/**
 * Verifies and decodes a JWT, returning its payload.
 *
 * PHASE 3 MIGRATION NOTE:
 * When Firebase Auth is wired up, this function gets replaced with
 * admin.auth().verifyIdToken(token) (returning Firebase's decoded
 * claims, which already carry the same uid/email/custom-claims shape).
 * Because every other file calls authService.verifyToken() rather than
 * jsonwebtoken directly, no other file needs to change.
 *
 * @param {string} token
 * @returns {Promise<{ uid, email, agency, role }>}
 * @throws If the token is invalid or expired — the caller
 *         (verifyAuth middleware) turns this into a 401.
 */
async function verifyToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);
  return {
    uid: decoded.uid,
    email: decoded.email,
    agency: decoded.agency,
    role: decoded.role,
  };
}

module.exports = { login, verifyToken };
