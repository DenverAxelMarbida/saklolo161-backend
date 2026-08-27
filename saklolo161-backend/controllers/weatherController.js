/**
 * controllers/weatherController.js
 * --------------------------------------------------------------
 * Handles the business logic for the weather + Marikina River
 * water level widget shown on Screen 1 of the mobile app.
 *
 * PHASE 1: Returns a mock snapshot so mobile devs can build the
 * UI immediately, without waiting on a live weather/river API key.
 * PHASE 2: Replace mockWeatherRiver below with a real service call
 * (e.g. PAGASA/OpenWeatherMap for weather, MMDA/DOST Project NOAH
 * or a Marikina LGU feed for river level), following the same
 * pattern mapboxService.js and semaphoreService.js already use.
 * --------------------------------------------------------------
 */

/**
 * Mock snapshot of current weather + Marikina River conditions.
 * Shaped to match exactly what Screen 1 expects to render.
 */
const mockWeatherRiver = {
  temperature: '28°C',
  condition: 'Partly Cloudy',
  humidity: '82%',
  wind: '12km/h',
  uvIndex: 7,
  riverLevelMeters: 15.2,
  riverStatus: 'Normal',
  alertLevel: 'Alert Level 1 begins at 15m',
  riskLevel: 'LOW RISK',
};

/**
 * GET /api/weather-river
 * Returns the current weather + river level snapshot for the
 * mobile app's home screen (Screen 1).
 */
function getWeatherRiver(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      message: 'Weather and river data retrieved successfully.',
      data: {
        ...mockWeatherRiver,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getWeatherRiver,
};
