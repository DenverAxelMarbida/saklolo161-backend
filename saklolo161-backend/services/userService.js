/**
 * services/userService.js
 * --------------------------------------------------------------
 * The ONLY backend layer that touches Firebase Admin Auth for
 * user-management operations (list / create / update / disable).
 * Controllers never import firebase-admin — they call these
 * functions (Hard Rule 2, same shape as authService/stationService).
 *
 * Valid agencies/roles are copied VERBATIM from the provisioning
 * source of truth in scripts/provisionUser.js (MEDICAL | FIRE |
 * FLOOD | CRIME | ALL and dispatcher | admin — lowercase roles,
 * uppercase agencies). provisionUser.js can't be required from
 * here: it's a CLI with no exports that runs main() (and
 * process.exit) on import, so the constants are mirrored exactly
 * rather than left to drift into incompatible copies.
 *
 * Passwords: a create password is passed straight to Firebase
 * Admin createUser() and never stored, logged, returned, or
 * echoed back — responses are built exclusively from mapUser().
 * --------------------------------------------------------------
 */

// Resolved per call (not destructured at load) so tests can swap the
// Firebase Auth instance on config/firebase without reloading the app.
function firebaseAuth() {
  return require('../config/firebase').getFirebaseAuth();
}

// Mirrored from scripts/provisionUser.js (see header comment).
const VALID_AGENCIES = ['MEDICAL', 'FIRE', 'FLOOD', 'CRIME', 'ALL'];
const VALID_ROLES = ['dispatcher', 'admin'];

/**
 * Maps a Firebase Admin UserRecord to the ONLY shape this API ever
 * exposes: account identity + status. No password (Firebase never
 * returns one), no tokens, no service-account data.
 */
function mapUser(record) {
  const claims = record.customClaims || {};

  return {
    uid: record.uid,
    email: record.email || '',
    agency: claims.agency || '',
    role: claims.role || '',
    disabled: record.disabled === true,
    createdAt: (record.metadata && record.metadata.creationTime) || null,
  };
}

/**
 * Lists every Firebase Auth account (mapped — never raw records).
 * @returns {Promise<Array<{uid,email,agency,role,disabled,createdAt}>>}
 */
async function listUsers() {
  const auth = firebaseAuth();
  const page = await auth.listUsers();
  return page.users.map(mapUser);
}

/**
 * Creates a Firebase Auth account and assigns its { agency, role }
 * custom claims. The password goes directly to Firebase and is
 * never retained anywhere in this process.
 *
 * @param {{ email: string, password: string, agency: string, role: string }}
 * @returns {Promise<object>} mapped user
 */
async function createUser({ email, password, agency, role }) {
  const auth = firebaseAuth();

  const created = await auth.createUser({ email, password });

  // Custom claims ride inside every ID token issued from now on —
  // that's what authService.buildPayload() reads agency/role from.
  await auth.setCustomUserClaims(created.uid, { agency, role });

  return {
    uid: created.uid,
    email,
    agency,
    role,
    disabled: false,
    createdAt: null,
  };
}

/**
 * Updates an existing account: email (when supplied) and/or the
 * { agency, role } custom claims (merged over the existing claims
 * so a partial body never wipes the other claim).
 *
 * @param {string} uid
 * @param {{ email?: string, agency?: string, role?: string }} changes
 * @returns {Promise<object>} mapped user
 * @throws Firebase auth/user-not-found (→ 404) for unknown uids
 */
async function updateUser(uid, { email, agency, role }) {
  const auth = firebaseAuth();

  // Resolved up front so an unknown uid 404s before any mutation
  // and so partial claim updates can merge over existing claims.
  const record = await auth.getUser(uid);

  if (email) {
    await auth.updateUser(uid, { email });
  }

  if (agency || role) {
    const claims = { ...(record.customClaims || {}) };
    if (agency) claims.agency = agency;
    if (role) claims.role = role;
    await auth.setCustomUserClaims(uid, claims);
  }

  const updated = await auth.getUser(uid);
  return mapUser(updated);
}

/**
 * Disables (or re-enables) an account — the supported alternative
 * to deletion, preserving attribution. Disabling also revokes
 * refresh tokens so already-signed-in sessions are cut short;
 * fresh logins are blocked by Firebase either way.
 *
 * @param {string} uid
 * @param {boolean} enabled
 * @returns {Promise<object>} mapped user
 */
async function setUserEnabled(uid, enabled) {
  const auth = firebaseAuth();

  await auth.updateUser(uid, { disabled: !enabled });

  if (!enabled) {
    await auth.revokeRefreshTokens(uid);
  }

  const record = await auth.getUser(uid);
  return mapUser(record);
}

/**
 * Sets a user's login password (self-service change flow). The new
 * password goes directly to Firebase Admin updateUser() and is
 * never stored, logged, or returned by this process.
 *
 * @param {string} uid
 * @param {string} password already policy-validated by the caller
 * @returns {Promise<void>}
 * @throws Firebase auth/user-not-found (→ 404) for unknown uids
 */
async function setPassword(uid, password) {
  const auth = firebaseAuth();
  await auth.updateUser(uid, { password });
}

module.exports = {
  VALID_AGENCIES,
  VALID_ROLES,
  listUsers,
  createUser,
  updateUser,
  setUserEnabled,
  setPassword,
};
