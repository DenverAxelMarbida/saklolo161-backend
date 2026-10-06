/**
 * middlewares/requireAdmin.js
 * --------------------------------------------------------------
 * Second gate on user-management routes: run AFTER verifyAuth so
 * req.user is already the frozen { uid, email, agency, role }
 * payload, then allow only role === 'admin' (lowercase, matching
 * the provisioning convention in scripts/provisionUser.js).
 *
 * A non-admin authenticated user gets 403 — an AUTHORIZATION
 * failure, deliberately distinct from verifyAuth's 401 so the
 * web client's 401 → logout interceptor never fires on it.
 * --------------------------------------------------------------
 */

/**
 * Express middleware: rejects anything that isn't an admin with 403.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required.',
    });
  }

  return next();
}

module.exports = requireAdmin;
