/**
 * middlewares/rateLimitPublic.js
 * --------------------------------------------------------------
 * Rate limiters for the public Phase 3 endpoints (no auth token):
 *   - GET /api/routes                     → 30 req / 10 min / IP
 *   - POST /api/incidents/:id/evidence    → 10 req / 10 min / IP
 *
 * Keyed by client IP (all public endpoints are anonymous). Dropped
 * requests get the standard envelope shape with a 429.
 * --------------------------------------------------------------
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function makePublicRateLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req),
    handler: (req, res) =>
      res.status(429).json({
        success: false,
        message,
      }),
  });
}

const routesRateLimiter = makePublicRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many routing requests from this address. Please try again later.',
});

const evidenceRateLimiter = makePublicRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many evidence uploads from this address. Please try again later.',
});

module.exports = { routesRateLimiter, evidenceRateLimiter, makePublicRateLimiter };