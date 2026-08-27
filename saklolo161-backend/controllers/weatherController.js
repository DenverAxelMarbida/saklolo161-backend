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


const axios = require('axios');
const NodeCache = require('node-cache');
const { OPENWEATHER_API_KEY } = require('../config/env');

// Cache data for 10 minutes (600 seconds)
const weatherCache = new NodeCache({ stdTTL: 600 });

async function getWeatherRiver(req, res, next) {
  try {
    const cacheKey = 'marikina_weather_river';

    // 1. Return cached response if available
    const cachedData = weatherCache.get(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: 'Weather and river data retrieved successfully (cached).',
        data: cachedData,
      });
    }

    // Default fallback values
    let liveTemp = '28°C';
    let liveCondition = 'Partly Cloudy';
    let liveHumidity = '82%';
    let liveWind = '12km/h';

    // 2. Fetch live weather if cache missed
    if (OPENWEATHER_API_KEY) {
      try {
        const weatherRes = await axios.get(
          `https://api.openweathermap.org/data/2.5/weather?lat=14.6507&lon=121.1029&units=metric&appid=${OPENWEATHER_API_KEY}`
        );

        liveTemp = `${Math.round(weatherRes.data.main.temp)}°C`;
        liveCondition = weatherRes.data.weather[0].main;
        liveHumidity = `${weatherRes.data.main.humidity}%`;
        liveWind = `${Math.round(weatherRes.data.wind.speed * 3.6)}km/h`;
      } catch (apiError) {
        console.error('OpenWeather API failed, using default values:', apiError.message);
      }
    }

    const responsePayload = {
      temperature: liveTemp,
      condition: liveCondition,
      humidity: liveHumidity,
      wind: liveWind,
      riverLevelMeters: 15.2,
      riverStatus: 'Normal',
      alertLevel: 'Alert Level 1 begins at 15m',
      riskLevel: 'LOW RISK',
      timestamp: new Date().toISOString(),
    };

    // 3. Save payload to cache
    weatherCache.set(cacheKey, responsePayload);

    return res.status(200).json({
      success: true,
      message: 'Weather and river data retrieved successfully.',
      data: responsePayload,
 });
  } catch (error) {
    next(error);
  }
}
module.exports = { getWeatherRiver };

