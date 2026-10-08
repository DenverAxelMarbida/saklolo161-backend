/**
 * services/textbeeService.js
 * --------------------------------------------------------------
 * Wraps all logic that talks to the TextBee SMS gateway API, used to
 * text status updates back to the citizen who reported an incident
 * (e.g. "Your report has been received", "Rescue team dispatched")
 * and to alert the responding station's duty phone on dispatch.
 *
 * Provider: TextBee — SMS is queued to the connected Android device
 * and sent through that phone's SIM. An HTTP 200 / success result
 * means TextBee ACCEPTED/QUEUED the message; it is not a guarantee
 * the handset delivered it. The gateway phone must stay online and
 * SMS-capable for sends to work.
 *
 * Current: real POST to TextBee's /api/v1/gateway/send-sms via
 * Node's built-in fetch, with a 10s AbortSignal.timeout() budget.
 * Authenticated with the TEXTBEE_API_KEY sent in the x-api-key
 * header (never in the request body, never logged or returned).
 *
 * CONTRACT WITH CALLERS (do not break):
 * sendSms() MUST NEVER reject. Incident creation, status updates and
 * dispatch all treat SMS as best-effort — a TextBee/network failure
 * resolves to { success: false, ... } instead of throwing, so it can
 * never fail the main operation (createIncident() doesn't even await
 * this call; a rejection there would be an unhandled rejection).
 *
 * No API key is ever logged or returned.
 * --------------------------------------------------------------
 */

const env = require('../config/env');

const TEXTBEE_ENDPOINT = 'https://api.textbee.dev/api/v1/gateway/send-sms';
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Sends an SMS notification to a citizen or a station duty phone.
 * Never rejects — every failure mode resolves to a result object.
 * @param {string} phoneNumber - e.g. "+639171234567"
 * @param {string} message
 * @returns {Promise<{success: boolean, mock: false, message: string, ...}>}
 */
async function sendSms(phoneNumber, message) {
  const apiKey = env.TEXTBEE_API_KEY;
  const deviceId = env.TEXTBEE_DEVICE_ID;

  // Not configured: skip entirely — never call TextBee with an empty key.
  if (!apiKey) {
    const skipMessage = 'TextBee SMS skipped: API key is not configured.';
    console.warn(skipMessage);
    return {
      success: false,
      mock: false,
      skipped: true,
      message: skipMessage,
    };
  }

  // Only pin a specific Android gateway phone when one is configured —
  // otherwise TextBee resolves its default (or most recently online)
  // device itself.
  const body = {
    recipients: [phoneNumber],
    message,
  };
  if (deviceId) body.deviceId = deviceId;

  let response;
  try {
    response = await fetch(TEXTBEE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const failureMessage = timedOut
      ? `TextBee SMS failed: request timed out after ${REQUEST_TIMEOUT_MS} ms.`
      : `TextBee SMS failed: ${error && error.message ? error.message : 'network error'}.`;
    console.error(failureMessage);
    return {
      success: false,
      mock: false,
      message: failureMessage,
      error: error && error.message ? error.message : String(error),
    };
  }

  let data = null;
  let parseError = null;
  try {
    data = await response.json();
  } catch (error) {
    parseError = error;
  }

  if (!response.ok) {
    // TextBee rejected the send (bad key, no online device, quota…).
    const failureMessage = `TextBee SMS failed: HTTP ${response.status}.`;
    console.error(failureMessage, data && data.message ? data.message : '');
    return {
      success: false,
      mock: false,
      message: failureMessage,
      error: { status: response.status, body: data },
    };
  }

  if (parseError) {
    const failureMessage = 'TextBee SMS failed: invalid JSON response.';
    console.error(failureMessage, parseError.message);
    return {
      success: false,
      mock: false,
      message: failureMessage,
      error: parseError.message,
    };
  }

  return {
    success: true,
    mock: false,
    message: 'TextBee SMS sent.',
    data,
  };
}

module.exports = { sendSms };
