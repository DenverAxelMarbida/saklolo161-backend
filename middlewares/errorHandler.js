/**
 * middlewares/errorHandler.js
 * --------------------------------------------------------------
 * Centralized error handler. Register this LAST in server.js so
 * it catches errors from any route/controller that calls next(err).
 *
 * Also exports a 404 handler for unmatched routes.
 * --------------------------------------------------------------
 */

function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('🔥 Unhandled error:', err.stack || err.message);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
}

module.exports = { notFoundHandler, errorHandler };
