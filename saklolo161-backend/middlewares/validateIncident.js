/**
 * middlewares/validateIncident.js
 * --------------------------------------------------------------
 * Basic field validation for POST /api/incidents.
 *
 * Runs BEFORE the controller, so the controller can trust that
 * required fields exist and are the right type/shape.
 * --------------------------------------------------------------
 */

const VALID_CATEGORIES = ['Medical', 'Fire', 'Flood'];

function validateIncident(req, res, next) {
  const { citizenPhone, category, location } = req.body;
  const errors = [];

  if (!citizenPhone || typeof citizenPhone !== 'string') {
    errors.push('citizenPhone is required and must be a string (e.g. "+639171234567").');
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    errors.push(`category is required and must be one of: ${VALID_CATEGORIES.join(', ')}.`);
  }

  if (!location || typeof location !== 'object') {
    errors.push('location object is required with latitude and longitude.');
  } else {
    const { latitude, longitude } = location;
    if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
      errors.push('location.latitude must be a number between -90 and 90.');
    }
    if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
      errors.push('location.longitude must be a number between -180 and 180.');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors,
    });
  }

  next();
}

module.exports = validateIncident;
