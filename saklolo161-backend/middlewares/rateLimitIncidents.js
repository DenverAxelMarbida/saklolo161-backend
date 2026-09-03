/**
 * middlewares/rateLimitIncidents.js
 * --------------------------------------------------------------
 * Rate limiter for POST /api/incidents (the public citizen-entry
 * point). Limits to 3 reports per citizenPhone per 10-minute
 * window; falls back to the client IP when citizenPhone is missing.
 *
 * Runs BEFORE validateIncident so abusive traffic is dropped
 * before any field validation or geocoding work.
 * --------------------------------------------------------------
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// eslint-disable-next-line no-unused-vars
const incidentRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3, // 3 reports per phone number per window
  standardHeaders: true, // return rate-limit info in standard `RateLimit-*` headers
  legacyHeaders: false, // disable `X-RateLimit-*` headers

  /**
   * Key requests by the reporter's phone number when present,
   * otherwise fall back to the client IP.
   */
  keyGenerator: (req) => {
    const phone = req.body ? req.body.citizenPhone : undefined;
    if (phone && typeof phone === 'string' && phone.trim()) {
      return `phone:${phone.trim()}`;
    }
    return ipKeyGenerator(req);
  },

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: 'Too many reports from this number. Please wait before submitting again.',
    });
  },
});

module.exports = incidentRateLimiter;