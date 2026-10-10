/**
 * services/smsQueue.js
 * --------------------------------------------------------------
 * Per-incident ordered SMS dispatch + duplicate-announcement guard.
 *
 * SMS policy is start/end only: citizens get a report-confirmation text
 * at creation and a resolution text on the genuine transition to
 * Resolved — nothing in between. Dispatch sends no SMS at all (station
 * contact stays voice-call). This queue still orders the two citizen
 * texts so the resolution can never be submitted before the
 * confirmation, and repeated or racing requests still produce no
 * duplicates.
 *
 * TWO PRIMITIVES:
 *   enqueue(incidentId, job)
 *     One FIFO chain per incident: `job` only starts once the previous
 *     job for that incident has settled, so submission order to
 *     TextBee matches event order (creation confirmation before
 *     resolution). Chains for DIFFERENT incidents never block each
 *     other, and the returned promise NEVER rejects — a failed job is
 *     logged and dropped (no retries), so awaiting it can never fail
 *     the caller's HTTP response and one event can never produce two
 *     messages.
 *   claimAnnouncement(incidentId, status)
 *     Synchronous check-and-set: returns true the first time a status
 *     is announced for an incident, false for every repeat — even when
 *     two identical requests race, because JS finishes the claim in
 *     one turn of the event loop before the other request can run it.
 *     Every genuine status transition claims (so leaving Resolved and
 *     coming back announces again), but only the Resolved claim leads
 *     to an SMS; the rest just record the transition for dedup.
 *
 * The chain state and the claims live in this process only (reset on
 * redeploy, like the mock incident store). Message content and the
 * TextBee request itself stay in services/textbeeService.js — this
 * module never sees API keys, phone numbers, or message bodies.
 * --------------------------------------------------------------
 */

// incidentId -> tail promise of that incident's chain (never rejects).
const chains = new Map();

// incidentId -> last status announced to the citizen. Every genuine
// transition claims its status (so a repeat still returns the normal
// 200 envelope but sends nothing); only the Resolved claim leads to
// an SMS — intermediate statuses are tracked for dedup only.
const lastAnnounced = new Map();

// Bound the claim map so a long-lived dev process can't grow it
// without limit. Oldest entries are the least likely to be repeated.
const MAX_TRACKED_INCIDENTS = 1000;

/**
 * Claims the right to announce `status` for an incident.
 * @param {string} incidentId
 * @param {string} status
 * @returns {boolean} true when this is the first announcement of that
 *                    status, false when it was already announced.
 */
function claimAnnouncement(incidentId, status) {
  if (lastAnnounced.get(incidentId) === status) return false;
  if (lastAnnounced.size >= MAX_TRACKED_INCIDENTS) {
    const oldest = lastAnnounced.keys().next().value;
    lastAnnounced.delete(oldest);
  }
  lastAnnounced.set(incidentId, status);
  return true;
}

/**
 * Appends `job` to the incident's ordered SMS chain.
 * Never rejects: a job that throws is logged and the chain continues
 * with the next job.
 * @param {string} incidentId orders jobs per incident
 * @param {Function} job () => Promise (or value) — the send itself
 * @returns {Promise<*>} resolves when this job (and every job queued
 *                       before it for the same incident) has settled.
 */
function enqueue(incidentId, job) {
  const previous = chains.get(incidentId) || Promise.resolve();
  const settled = previous
    .then(() => job())
    .catch((error) => {
      console.error(
        `smsQueue: SMS job failed for ${incidentId}:`,
        error && error.message ? error.message : error
      );
    });

  chains.set(incidentId, settled);
  // Drop the chain once this job is the tail and has settled, so ids
  // don't accumulate; a later enqueue simply starts a fresh chain.
  settled.then(() => {
    if (chains.get(incidentId) === settled) chains.delete(incidentId);
  });

  return settled;
}

module.exports = { enqueue, claimAnnouncement };
