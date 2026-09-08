/**
 * services/evidenceService.js
 * --------------------------------------------------------------
 * Evidence upload seam. Controllers never touch multer/buffer/storage
 * details beyond handing this service the processed `file`.
 *
 * PHASE 3 (current): GET /api/incidents/:id/evidence accepts and
 * validates the upload, but file storage is not live yet — `url` is
 * an empty string and the record is metadata-only. Web/mobile must
 * NOT try to render uploaded `url` values until the Firebase Storage
 * cutover (coordinated Phase 3 window) returns real URLs.
 *
 * PHASE 5 (Firebase cutover): implement uploadEvidenceFile() to write
 * req.file.buffer to Firebase Storage and return the real download
 * URL — this file is the only place that changes.
 * --------------------------------------------------------------
 */

const crypto = require('crypto');

/**
 * Produces the contract-shaped evidence record for an uploaded file.
 * @param {Object} file multer file: { buffer, originalname, mimetype, size }
 * @returns {Promise<{fileId, url, mimeType, sizeKb, uploadedAt}>}
 */
async function createEvidenceRecord(file) {
  const fileId = `ev-${crypto.randomUUID()}`;

  // Storage is not live until the Firebase cutover — keep metadata
  // accurate, leave the URL empty rather than inventing a fake one.
  const url = await uploadEvidenceFile(file);

  return {
    fileId,
    url,
    mimeType: file.mimetype,
    sizeKb: Math.round(file.size / 1024),
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * Persists the file bytes and returns a renderable download URL.
 * @param {Object} file multer file
 * @returns {Promise<string>} '' until Firebase Storage is live.
 */
async function uploadEvidenceFile(file) {
  // Firebase Storage cutover writes `file.buffer` here and returns
  // the real download URL.
  return '';
}

module.exports = { createEvidenceRecord, uploadEvidenceFile };