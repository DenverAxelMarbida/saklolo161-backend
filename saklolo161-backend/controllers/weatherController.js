/**
 * controllers/weatherController.js
 * --------------------------------------------------------------
 * Handles the business logic for the weather + Marikina River
 * water level widget shown on Screen 1 of the mobile app.
 *
 * PHASE 1: Returns a mock snapshot so mobile devs can build the
 * UI immediately, without waiting on a live weather/river API key.
 * PHASE 3: River level now comes from the live PAGASA feed through
 * services/riverService.js. When the feed is unreachable the
 * service degrades back to mock values internally — the response
 * shape never changes, only `source` ("pagasa" | "mock") tells the
 * caller which one is in effect.
 * --------------------------------------------------------------
 */

const axios = require('axios');
const NodeCache = require('node-cache');
const { OPENWEATHER_API_KEY } = require('../config/env');
const { getRiverStatus } = require('../services/riverService');

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

    // 3. River level goes through riverService (never throws) —
    //    `null` means the PAGASA feed degraded, so mock values below.
    const river = await getRiverStatus();

    const responsePayload = {
      temperature: liveTemp,
      condition: liveCondition,
      humidity: liveHumidity,
      wind: liveWind,
      riverLevelMeters: river ? river.riverLevelMeters : 15.2,
      riverStatus: river ? river.riverStatus : 'Normal',
      alertLevel: river ? river.alertLevel : 'Alert Level 1 begins at 15m',
      riskLevel: river ? river.riskLevel : 'LOW RISK',
      timestamp: new Date().toISOString(),
      source: river ? river.source : 'mock',
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


