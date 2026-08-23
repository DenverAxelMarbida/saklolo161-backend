/**
 * services/semaphoreService.js
 * --------------------------------------------------------------
 * Wraps all logic that talks to the Semaphore SMS API, used to
 * text status updates back to the citizen who reported an incident
 * (e.g. "Your report has been received", "Rescue team dispatched").
 *
 * PHASE 1 (current): sendSms() just logs to the console so the
 * team can see the flow working without burning real SMS credits.
 *
 * PHASE 2 (Database/Notification Engine developer): replace the
 * mock block with a real POST call to Semaphore's /api/v4/messages
 * endpoint.
 * --------------------------------------------------------------
 */

const { SEMAPHORE_API_KEY, SEMAPHORE_SENDER_NAME } = require('../config/env');

/**
 * Sends an SMS notification to a citizen.
 * @param {string} phoneNumber - e.g. "+639171234567"
 * @param {string} message
 * @returns {Promise<{success: boolean, mock: boolean, message: string}>}
 */
async function sendSms(phoneNumber, message) {
  // ---- REAL SEMAPHORE CALL (uncomment for Phase 2) -------------------
  //
  // const response = await fetch('https://api.semaphore.co/api/v4/messages', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     apikey: SEMAPHORE_API_KEY,
  //     number: phoneNumber,
  //     message,
  //     sendername: SEMAPHORE_SENDER_NAME,
  //   }),
  // });
  // return response.json();
  // ----------------------------------------------------------------------

  // ---- MOCK MODE (Phase 1) ---------------------------------------------
  console.log(`📲 [MOCK SMS] To: ${phoneNumber} | Message: "${message}"`);
  return {
    success: true,
    mock: true,
    message: `Mock SMS logged for ${phoneNumber}`,
  };
}

module.exports = { sendSms };
