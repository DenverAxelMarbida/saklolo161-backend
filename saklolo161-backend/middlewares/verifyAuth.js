/**
 * middlewares/verifyAuth.js
 * --------------------------------------------------------------
 * Guards dispatcher/admin-only routes behind a valid Bearer JWT.
 *
 * Runs BEFORE a protected controller, reads the Authorization header,
 * verifies the token via services/authService.verifyToken(), and on
 * success attaches the decoded payload to req.user for downstream
 * agency-scoped checks.
 * --------------------------------------------------------------
 */

const authService = require('../services/authService');

/**
 * Express middleware: verifies the "Bearer <token>" Authorization header.
 * On success sets req.user = { uid, email, agency, role } and calls next().
 * On missing/malformed/expired token responds 401.
 */
async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'No token provided.',
    });
  }

  const token = authHeader.slice('Bearer '.length).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No token provided.',
    });
  }

  try {
    const payload = await authService.verifyToken(token);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
}

module.exports = verifyAuth;
