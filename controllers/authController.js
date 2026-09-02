/**
 * controllers/authController.js
 * --------------------------------------------------------------
 * Handles the business logic for staff authentication.
 * Talks to services/authService.js (which owns bcryptjs/jsonwebtoken
 * and the mockUsers store) — routes stay thin and just point here.
 * --------------------------------------------------------------
 */

const authService = require('../services/authService');

/**
 * POST /api/auth/login
 * Receives { email, password }, validates credentials via
 * authService, and on success issues a JWT.
 *
 * Success: 200 { success: true, data: { token, user } }
 * Failure: 401 { success: false, message: err.message }
 *          (authService throws a generic "Invalid email or password.")
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const { token, user } = await authService.login(email, password);

    return res.status(200).json({
      success: true,
      data: { token, user },
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.message,
    });
  }
}

module.exports = { login };
