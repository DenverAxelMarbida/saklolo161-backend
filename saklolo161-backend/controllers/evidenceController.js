/**
 * controllers/evidenceController.js
 * --------------------------------------------------------------
 * Handles POST /api/incidents/:id/evidence — the public, rate-limited
 * Phase 3 endpoint where the mobile app attaches a photo/attachment
 * to an incident it reported.
 *
 * multer is applied at the route layer (see incidentRoutes.js) and
 * hands us a parsed `req.file`. Returns 200 with the contract-shaped
 * evidence record.
 * --------------------------------------------------------------
 */

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

    const record = await evidenceService.createEvidenceRecord(req.file);
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

module.exports = { addEvidence };