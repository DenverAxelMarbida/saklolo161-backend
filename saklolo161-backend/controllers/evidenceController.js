/**
 * controllers/evidenceController.js
 * --------------------------------------------------------------
 * Handles the evidence endpoints:
 *   POST /api/incidents/:id/evidence  - public, rate-limited attach
 *   GET  /api/incidents/:id/evidence/:fileId/media - public media
 *
 * multer is applied at the route layer (see incidentRoutes.js) and
 * hands us a parsed `req.file`. POST returns 200 with the
 * contract-shaped evidence record; GET streams the stored bytes back
 * with Express's sendFile (native Range support → video seeking).
 * --------------------------------------------------------------
 */

const fs = require('fs');
const incidentService = require('../services/incidentService');
const evidenceService = require('../services/evidenceService');

async function addEvidence(req, res, next) {
  try {
    const { id } = req.params;

    const incident = await incidentService.findById(id);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident ${id} not found.`,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded.',
        errors: ['A file is required on the "file" field (multipart/form-data).'],
      });
    }

    const record = await evidenceService.createEvidenceRecord(req.file, {
      incidentId: id,
    });
    const updated = await incidentService.addEvidence(id, record);

    return res.status(200).json({
      success: true,
      message: 'Evidence uploaded successfully.',
      data: record,
      incidentId: updated.incidentId,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Streams the bytes for a stored evidence record back to the client.
 * Public (mobile renders media without any auth header). Only serves
 * records that actually belong to the incident in the URL, so a fileId
 * can't be fetched blind without knowing its incident already.
 */
async function getEvidenceMedia(req, res, next) {
  try {
    const { id, fileId } = req.params;

    const incident = await incidentService.findById(id);
    const record =
      incident &&
      Array.isArray(incident.evidence) &&
      incident.evidence.find((e) => e.fileId === fileId);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: `Evidence ${fileId} not found for incident ${id}.`,
      });
    }

    const mediaPath = evidenceService.mediaPathFor(fileId);
    if (!fs.existsSync(mediaPath)) {
      return res.status(404).json({
        success: false,
        message: `Evidence ${fileId} is not available.`,
      });
    }

    return res.sendFile(mediaPath, {
      headers: { 'Content-Type': record.mimeType },
      acceptRanges: true,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { addEvidence, getEvidenceMedia };