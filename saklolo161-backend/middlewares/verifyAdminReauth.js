/**
 * middlewares/verifyAdminReauth.js
 * --------------------------------------------------------------
 * Shared reauthentication helper for sensitive admin actions
 * (disable user, admin password reset, station edit, station
 * deactivation). `adminPassword` is checked against req.user.email —
 * the verified token's email, never a client-supplied identity —
 * using authService.verifyPassword (the same reauthenticateWithCredential
 * equivalent the self-service password change uses).
 *
 * Wrong/missing credentials respond 400 (NOT 401: 401 means
 * "session dead" and clients sign the admin out on it).
 * The password itself is never logged or echoed back.
 *
 * @returns {boolean} true when reauthentication succeeded.
 * --------------------------------------------------------------
 */

const authService = require('../services/authService');

async function verifyAdminReauth(req, res, adminPassword) {
  if (!adminPassword || typeof adminPassword !== 'string') {
    res.status(400).json({
      success: false,
      message: 'Administrator password is required.',
    });
    return false;
  }

  const valid = await authService.verifyPassword(req.user.email, adminPassword);
  if (!valid) {
    res.status(400).json({
      success: false,
      message: 'Administrator password is incorrect.',
    });
    return false;
  }
  return true;
}

module.exports = verifyAdminReauth;
