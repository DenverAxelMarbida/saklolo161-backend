/**
 * services/evidenceService.js
 * --------------------------------------------------------------
 * Evidence upload seam. Controllers never touch multer/buffer/storage
 * details beyond handing this service the processed `file`.
 *
 * PHASE 3 (current): uploads are written to a local `uploads/evidence`
 * directory (multer diskStorage, see incidentRoutes.js) and served back
 * by GET /api/incidents/:id/evidence/:fileId/media. `url` is a RELATIVE
 * path so clients resolve it against their own API base — this works on
 * a LAN IP for the phone and behind Render's TLS without baking the
 * request host/protocol into stored data.
 *
 * PHASE 5 (Firebase cutover): implement uploadEvidenceFile() to write
 * req.file.buffer to Firebase Storage and return the real absolute
 * download URL — this file is the only place that changes. Clients
 * already tolerate both (helpers resolve a leading-slash path against
 * their API base and pass absolute URLs through untouched).
 * --------------------------------------------------------------
 */

const path = require('path');
const crypto = require('crypto');

// Single source of truth for where evidence bytes live on disk.
// Multer's diskStorage writes here; the media controller reads here.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'evidence');

/**
 * Produces the contract-shaped evidence record for an uploaded file.
 * @param {Object} file multer file: { path, filename, originalname, mimetype, size }
 * @param {Object} ctx { incidentId } — used to build the media URL.
 * @returns {Promise<{fileId, url, mimeType, sizeKb, uploadedAt}>}
 */
async function createEvidenceRecord(file, ctx) {
  const fileId = file.filename || `ev-${crypto.randomUUID()}`;

  const url = await uploadEvidenceFile(file, { ...ctx, fileId });

  return {
    fileId,
    url,
    mimeType: file.mimetype,
    sizeKb: Math.round(file.size / 1024),
    uploadedAt: new Date().toISOString(),
  };
}

/**
 * Finds the on-disk path for a stored evidence record.
 * @param {string} fileId
 * @returns {string} absolute path (may not exist).
 */
function mediaPathFor(fileId) {
  return path.join(UPLOAD_DIR, fileId);
}

/**
 * Returns the media URL for a stored record. Relative so any client
 * (LAN phone, TLS web) resolves it against its own API base.
 * @param {Object} file multer file
 * @param {Object} ctx { incidentId, fileId }
 * @returns {Promise<string>}
 */
async function uploadEvidenceFile(file, ctx) {
  // multer diskStorage already persisted the bytes at file.path (named
  // by fileId). The Firebase Storage cutover replaces this function body
  // — writing to Storage and returning the absolute download URL.
  return `/api/incidents/${ctx.incidentId}/evidence/${ctx.fileId}/media`;
}

module.exports = {
  createEvidenceRecord,
  uploadEvidenceFile,
  mediaPathFor,
  UPLOAD_DIR,
};