/**
 * scripts/spike-pagasa.js
 * --------------------------------------------------------------
 * One-off discovery probe for the PAGASA Pasig-Marikina-Tullahan
 * FFWS water-level feed. Purpose: find out the ACTUAL response
 * format BEFORE writing the parser in services/riverService.js.
 *
 * FINDINGS (verified 2026):
 *   - The Tomcat endpoint REJECTS GET (HTTP 405). It requires POST.
 *   - POST /water/table_list.do -> 200 application/json, an array of
 *     station records like:
 *     { "obscd":"11103202", "obsnm":"Nangka", "wl":"15.76(*)",
 *       "wl30m":"...", "wl1h":"...", "wl2h":"...",
 *       "alertwl":"16.50", "alarmwl":"17.10", "criticalwl":"17.70" }
 *   - "wl" may carry a "(*)" stability suffix (strip it) and the
 *     threshold fields may be null.
 *   - The site serves a certificate chain Node does not trust by
 *     default on some hosts (Windows local); curl via the OS store
 *     works. Server-side TLS handling is a deployment decision —
 *     see services/riverService.js.
 *
 * Run: node scripts/spike-pagasa.js
 * --------------------------------------------------------------
 */

const axios = require('axios');
const { PAGASA_RIVER_ENDPOINT } = require('../config/env');

async function spike() {
  const url = PAGASA_RIVER_ENDPOINT;
  console.log(`PAGASA river feed spike`);
  console.log(`URL: ${url}`);
  console.log('---');

  try {
    const res = await axios.post(url, null, {
      timeout: 8000,
      headers: {
        'User-Agent': 'SAKLOLO161-backend/1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json,text/html;q=0.8,*/*;q=0.5',
      },
    });

    console.log('STATUS:', res.status);
    console.log('HEADERS:', JSON.stringify(res.headers, null, 2));
    console.log('---');
    console.log('CONTENT-TYPE:', (res.headers['content-type'] || '').split(';')[0]);
    console.log('BODY (first 4000 chars):');
    console.log(typeof res.data === 'string' ? res.data.slice(0, 4000) : JSON.stringify(res.data, null, 2).slice(0, 4000));
  } catch (error) {
    console.error('SPIKE FAILED:');
    if (error.response) {
      console.error('  status:', error.response.status);
      console.error('  headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('  body (first 2000 chars):', String(error.response.data || '').slice(0, 2000));
    } else if (error.request) {
      console.error('  request reached server but no response / transport error:', error.message);
    } else {
      console.error('  setup error:', error.message);
    }
  }
}

spike();