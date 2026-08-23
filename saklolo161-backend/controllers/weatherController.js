/**
 * controllers/weatherController.js
 * --------------------------------------------------------------
 * Handles the business logic for the weather + Marikina River
 * water level widget shown on Screen 1 of the mobile app.
 * --------------------------------------------------------------
 */

const axios = require('axios');
const { OPENWEATHER_API_KEY } = require('../config/env');

async function getWeatherRiver(req, res, next) {
  try {
    let liveTemp = '28°C';
    let liveCondition = 'Partly Cloudy';
    let liveHumidity = '82%';
    let liveWind = '12km/h';

    // Fetch live weather for Marikina City (Lat: 14.6507, Lon: 121.1029)
    if (OPENWEATHER_API_KEY) {
      try {
        const weatherRes = await axios.get(
          `https://api.openweathermap.org/data/2.5/weather?lat=14.6507&lon=121.1029&units=metric&appid=${OPENWEATHER_API_KEY}`
        );

        liveTemp = `${Math.round(weatherRes.data.main.temp)}°C`;
        liveCondition = weatherRes.data.weather[0].main;
        liveHumidity = `${weatherRes.data.main.humidity}%`;
        liveWind = `${Math.round(weatherRes.data.wind.speed * 3.6)}km/h`; // m/s to km/h
      } catch (apiError) {
        console.error('OpenWeather API failed, using default values:', apiError.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Weather and river data retrieved successfully.',
      data: {
        // DYNAMIC (From OpenWeatherMap API)
        temperature: liveTemp,
        condition: liveCondition,
        humidity: liveHumidity,
        wind: liveWind,

        // SIMULATED TELEMETRY (No public LGU API available)
        riverLevelMeters: 15.2,
        riverStatus: 'Normal',
        alertLevel: 'Alert Level 1 begins at 15m',
        riskLevel: 'LOW RISK',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getWeatherRiver };