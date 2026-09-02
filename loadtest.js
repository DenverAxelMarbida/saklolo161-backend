/**
 * loadtest.js
 * --------------------------------------------------------------
 * Load-tests POST /api/incidents on the deployed Saklolo 161 API.
 *
 * Run this directly with Node instead of the autocannon CLI —
 * that avoids PowerShell's native-executable argument re-parsing,
 * which mangles JSON bodies passed via -b on Windows.
 *
 * Setup (one time):
 *   npm install --save-dev autocannon
 *
 * Run:
 *   node loadtest.js
 * --------------------------------------------------------------
 */

const autocannon = require('autocannon');

const payload = {
  citizenPhone: '+639171234567',
  category: 'Fire',
  notes: 'Load test fire',
  location: {
    latitude: 14.6428,
    longitude: 121.1028,
    address: 'Marikina',
  },
};

autocannon(
  {
    url: 'https://saklolo161-backend.onrender.com/api/incidents',
    connections: 50,
    duration: 10,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  },
  (err, result) => {
    if (err) {
      console.error('Load test failed to run:', err);
      return;
    }
    console.log(autocannon.printResult(result));
    console.log(`\n2xx responses: ${result['2xx']}`);
    console.log(`non-2xx responses: ${result.non2xx}`);
    console.log(`errors: ${result.errors}`);
  }
);