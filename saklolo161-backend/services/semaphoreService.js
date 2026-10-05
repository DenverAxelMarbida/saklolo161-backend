/**
 * services/semaphoreService.js
 * --------------------------------------------------------------
 * Wraps all logic that talks to the Semaphore SMS API, used to
 * text status updates back to the citizen who reported an incident
 * (e.g. "Your report has been received", "Rescue team dispatched")
 * and to alert the responding station's duty phone on dispatch.
 *
 * PHASE 2 (current): real POST to Semaphore's /api/v4/messages via
 * Node's built-in fetch, with a 10s AbortSignal.timeout() budget.
 *
 * CONTRACT WITH CALLERS (do not break):
 * sendSms() MUST NEVER reject. Incident creation, status updates and
 * dispatch all treat SMS as best-effort — a Semaphore/network failure
 * resolves to { success: false, ... } instead of throwing, so it can
 * never fail the main operation (createIncident() doesn't even await
 * this call; a rejection there would be an unhandled rejection).
 *
 * No API key is ever logged or returned.
 * --------------------------------------------------------------
 */

const env = require('../config/env');

const SEMAPHORE_ENDPOINT = 'https://api.semaphore.co/api/v4/messages';
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Sends an SMS notification to a citizen or a station duty phone.
 * Never rejects — every failure mode resolves to a result object.
 * @param {string} phoneNumber - e.g. "+639171234567"
 * @param {string} message
 * @returns {Promise<{success: boolean, mock: false, message: string, ...}>}
 */
async function sendSms(phoneNumber, message) {
  const apiKey = env.SEMAPHORE_API_KEY;
  const senderName = env.SEMAPHORE_SENDER_NAME;

  // Not configured: skip entirely — never call Semaphore with an empty key.
  if (!apiKey) {
    const skipMessage = 'Semaphore SMS skipped: API key is not configured.';
    console.warn(skipMessage);
    return {
      success: false,
      mock: false,
      skipped: true,
      message: skipMessage,
    };
  }

  let response;
  try {
    response = await fetch(SEMAPHORE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: apiKey,
        number: phoneNumber,
        message,
        sendername: senderName,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const failureMessage = timedOut
      ? `Semaphore SMS failed: request timed out after ${REQUEST_TIMEOUT_MS} ms.`
      : `Semaphore SMS failed: ${error && error.message ? error.message : 'network error'}.`;
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
    // Semaphore rejected the send (bad number, bad key, quota…).
    const failureMessage = `Semaphore SMS failed: HTTP ${response.status}.`;
    console.error(failureMessage, data && data.message ? data.message : '');
    return {
      success: false,
      mock: false,
      message: failureMessage,
      error: { status: response.status, body: data },
    };
  }

  if (parseError) {
    const failureMessage = 'Semaphore SMS failed: invalid JSON response.';
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
    message: 'Semaphore SMS sent.',
    data,
  };
}

module.exports = { sendSms };
