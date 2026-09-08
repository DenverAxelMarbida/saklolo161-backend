/**
 * services/riverService.js
 * --------------------------------------------------------------
 * Live Marikina River water level from the PAGASA
 * Pasig-Marikina-Tullahan FFWS public feed. Backend-only seam kept
 * out of controllers, mirroring the stationService/authService
 * pattern so the feed source stays swappable in one file.
 *
 * The feed's Tomcat server presents only its leaf certificate, which
 * Node's default CA store doesn't trust on every host — so this
 * service validates the connection against the pinned chain in
 * config/pagasa-ca.pem (regenerate it with
 * `node scripts/refresh-pagasa-ca.js` when the leaf rotates).
 *
 * Never throws. On any failure (network, TLS, parse, unknown
 * station, null thresholds) it logs the reason and returns `null`,
 * and the caller falls back to its mock values.
 * --------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const { PAGASA_RIVER_ENDPOINT, PAGASA_RIVER_STATION } = require('../config/env');

const PIN_PATH = path.join(__dirname, '..', 'config', 'pagasa-ca.pem');

const CA_PEM = loadPin();

function loadPin() {
  try {
    return fs.readFileSync(PIN_PATH, 'utf8');
  } catch (e) {
    console.error(`riverService: could not read ${PIN_PATH}: ${e.message}`);
    return null;
  }
}

const agent = CA_PEM ? new https.Agent({ ca: CA_PEM }) : null;

const toMeters = (value) => {
  if (value == null) return null;
  const n = parseFloat(String(value).replace('*', '').trim());
  return Number.isFinite(n) ? n : null;
};

function classifyRiver(obs, alert, alarm, critical) {
  if (critical != null && obs >= critical) {
    return { status: 'Critical', risk: 'HIGH RISK', level: `Critical water level reached (${obs}m)` };
  }
  if (alarm != null && obs >= alarm) {
    return { status: 'Alarm', risk: 'HIGH RISK', level: `Alarm level reached. Level 3 begins at ${critical}m` };
  }
  if (alert != null && obs >= alert) {
    return { status: 'Alert', risk: 'MEDIUM RISK', level: `Alert level reached. Level 2 begins at ${alarm}m` };
  }
  return {
    status: 'Normal',
    risk: 'LOW RISK',
    level: alert != null ? `No alert. Level 1 begins at ${alert}m` : 'No alert levels published for this station',
  };
}

/**
 * Returns the river snapshot `{ riverLevelMeters, riverStatus,
 * alertLevel, riskLevel, source }` or `null` when the feed is
 * unreachable / unusable.
 */
async function getRiverStatus() {
  try {
    // Feed rejects GET (405) and wants form-encoded POST semantics.
    const res = await axios.post(PAGASA_RIVER_ENDPOINT, '', {
      timeout: 8000,
      httpsAgent: agent,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 3,
    });

    if (!Array.isArray(res.data)) {
      console.error(`riverService: unexpected feed payload (${typeof res.data})`);
      return null;
    }

    const station = res.data.find(
      (s) =>
        s &&
        typeof s.obsnm === 'string' &&
        s.obsnm.trim().toLowerCase() === PAGASA_RIVER_STATION.toLowerCase()
    );

    if (!station) {
      console.error(`riverService: station "${PAGASA_RIVER_STATION}" not in feed`);
      return null;
    }

    const obs = toMeters(station.wl);
    const alert = toMeters(station.alertwl);
    const alarm = toMeters(station.alarmwl);
    const critical = toMeters(station.criticalwl);

    if (obs == null) {
      console.error(`riverService: station "${PAGASA_RIVER_STATION}" has no numeric wl (${JSON.stringify(station.wl)})`);
      return null;
    }

    const cls = classifyRiver(obs, alert, alarm, critical);

    return {
      riverLevelMeters: obs,
      riverStatus: cls.status,
      alertLevel: cls.level,
      riskLevel: cls.risk,
      timestamp: new Date().toISOString(),
      source: 'pagasa',
    };
  } catch (error) {
    console.error('riverService: live feed failed, degrading to mock:', error.message);
    return null;
  }
}

module.exports = { getRiverStatus };