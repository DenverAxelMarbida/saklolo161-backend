/**
 * middlewares/errorHandler.js
 * --------------------------------------------------------------
 * Centralized error handler. Register this LAST in server.js so
 * it catches errors from any route/controller that calls next(err).
 *
 * Also exports a 404 handler for unmatched routes.
 * --------------------------------------------------------------
 */

const multer = require('multer');

function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('🔥 Unhandled error:', err.stack || err.message);

  // Multer upload errors surface as plain errors — map the common
  // ones to a client-friendly 400 instead of a 500.
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File exceeds the 200 MB upload limit.'
        : `Upload failed: ${err.message}`;
    return res.status(400).json({ success: false, message });
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
}

module.exports = { notFoundHandler, errorHandler };
