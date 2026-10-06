/**
 * controllers/userController.js
 * --------------------------------------------------------------
 * Admin user-management endpoints. Talks only to
 * services/userService.js (never firebase-admin directly — Hard
 * Rule 2) and follows the { success, message, data } response
 * convention used across the gateway.
 *
 * Status codes:
 *   200 GET/PATCH success · 201 POST success
 *   400 validation        · 403 authenticated non-admin (requireAdmin)
 *   404 unknown uid       · 500 unexpected server failure
 *
 * Firebase error internals are never echoed — known auth/* codes
 * map to fixed client-safe messages, anything else collapses to a
 * generic 500.
 * --------------------------------------------------------------
 */

const userService = require('../services/userService');
const authService = require('../services/authService');
const { passwordFailures } = require('../services/passwordPolicy');

const { VALID_AGENCIES, VALID_ROLES } = userService;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Maps Firebase Admin Auth error codes to safe client responses.
 * Unknown codes → generic 500 (logged server-side only).
 */
function respondWithFirebaseError(res, err) {
  switch (err && err.code) {
    case 'auth/email-already-exists':
      return res.status(400).json({
        success: false,
        message: 'That email is already registered.',
      });
    case 'auth/invalid-email':
      return res.status(400).json({
        success: false,
        message: 'Enter a valid email address.',
      });
    case 'auth/invalid-password':
    case 'auth/weak-password':
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.',
      });
    case 'auth/user-not-found':
    case 'auth/uid-not-found':
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    default:
      console.error('userController unexpected error:', err && err.message);
      return res.status(500).json({
        success: false,
        message: 'Unexpected server error.',
      });
  }
}

/**
 * GET /api/users → 200 { success, message, data: [mapped users] }
 */
async function listUsers(req, res) {
  try {
    const users = await userService.listUsers();

    return res.status(200).json({
      success: true,
      message: 'Users retrieved successfully.',
      data: users,
    });
  } catch (err) {
    return respondWithFirebaseError(res, err);
  }
}

/**
 * POST /api/users
 * Body: { email, password, agency, role } → 201.
 * The password is forwarded once to Firebase and never persisted
 * or echoed here.
 */
async function createUser(req, res) {
  try {
    const { email, password, agency, role } = req.body || {};

    if (!email || typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'A valid email is required.',
      });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'password is required.',
      });
    }
    const policyFailures = passwordFailures(password);
    if (policyFailures.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Password ${policyFailures.join('; ')}.`,
      });
    }
    if (!VALID_AGENCIES.includes(agency)) {
      return res.status(400).json({
        success: false,
        message: `agency must be one of: ${VALID_AGENCIES.join(', ')}.`,
      });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `role must be one of: ${VALID_ROLES.join(', ')}.`,
      });
    }

    const user = await userService.createUser({
      email: email.trim(),
      password,
      agency,
      role,
    });

    return res.status(201).json({
      success: true,
      message: 'User created successfully.',
      data: user,
    });
  } catch (err) {
    return respondWithFirebaseError(res, err);
  }
}

/**
 * PATCH /api/users/:uid
 * Body: any subset of { email, agency, role } → 200.
 */
async function updateUser(req, res) {
  try {
    const { uid } = req.params;
    const body = req.body || {};
    const changes = {};

    if (body.email !== undefined) {
      if (
        typeof body.email !== 'string' ||
        !EMAIL_PATTERN.test(body.email.trim())
      ) {
        return res.status(400).json({
          success: false,
          message: 'A valid email is required.',
        });
      }
      changes.email = body.email.trim();
    }
    if (body.agency !== undefined) {
      if (!VALID_AGENCIES.includes(body.agency)) {
        return res.status(400).json({
          success: false,
          message: `agency must be one of: ${VALID_AGENCIES.join(', ')}.`,
        });
      }
      changes.agency = body.agency;
    }
    if (body.role !== undefined) {
      if (!VALID_ROLES.includes(body.role)) {
        return res.status(400).json({
          success: false,
          message: `role must be one of: ${VALID_ROLES.join(', ')}.`,
        });
      }
      changes.role = body.role;
    }

    const user = await userService.updateUser(uid, changes);

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: user,
    });
  } catch (err) {
    return respondWithFirebaseError(res, err);
  }
}

/**
 * PATCH /api/users/:uid/status
 * Body: { enabled: true | false } → 200.
 * Disabling (not deleting) is the supported way to revoke access.
 */
async function setUserEnabled(req, res) {
  try {
    const { uid } = req.params;
    const { enabled } = req.body || {};

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean.',
      });
    }

    const user = await userService.setUserEnabled(uid, enabled);

    return res.status(200).json({
      success: true,
      message: enabled ? 'User enabled.' : 'User disabled.',
      data: user,
    });
  } catch (err) {
    return respondWithFirebaseError(res, err);
  }
}

/**
 * POST /api/users/me/password — self-service change (any authenticated
 * user, admin OR dispatcher; NO requireAdmin on this route).
 * Body: { currentPassword, newPassword, confirmNewPassword } → 200.
 *
 * uid/email ALWAYS come from req.user (the verified token) — a
 * uid/email in the body is ignored, so nobody can target another
 * account. The current password is re-verified against Firebase
 * (authService.verifyPassword — the reauthenticateWithCredential
 * equivalent) before userService.setPassword applies the new one.
 * Neither password is ever logged or echoed back.
 */
async function changeOwnPassword(req, res) {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body || {};

    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Current password is required.',
      });
    }
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'New password is required.',
      });
    }
    if (!confirmNewPassword || typeof confirmNewPassword !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please confirm the new password.',
      });
    }
    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match.',
      });
    }

    const policyFailures = passwordFailures(newPassword);
    if (policyFailures.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Password ${policyFailures.join('; ')}.`,
      });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from the current password.',
      });
    }

    // Re-authentication: prove the current password for the token's
    // own email before touching Firebase.
    const currentPasswordValid = await authService.verifyPassword(
      req.user.email,
      currentPassword
    );
    if (!currentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect.',
      });
    }

    await userService.setPassword(req.user.uid, newPassword);

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully.',
    });
  } catch (err) {
    return respondWithFirebaseError(res, err);
  }
}

module.exports = { listUsers, createUser, updateUser, setUserEnabled, changeOwnPassword };
