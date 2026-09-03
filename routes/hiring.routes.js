const express = require('express');
const router = express.Router();
const hiringController = require('../controllers/hiring.controller');

// Get all candidates & hiring stats
router.get('/candidates', hiringController.getCandidates);

// Mark a candidate's incoming WhatsApp messages as read
router.post('/candidate/:id/read', hiringController.markCandidateMessagesRead);

// Schedule Interview & Send Instant WhatsApp Confirmation
router.post('/schedule', hiringController.scheduleCandidateInterview);

// Send Manual / Instant Reminder (Missing Resume or Interview)
router.post('/send-reminder', hiringController.sendCandidateReminder);

// Send Custom WhatsApp Message to Candidate
router.post('/send-message', hiringController.sendCandidateMessage);

// Create Candidate Manually
router.post('/candidate', hiringController.createCandidate);

// Update Candidate Details
router.put('/candidate/:id', hiringController.updateCandidate);

// Delete Candidate
router.delete('/candidate/:id', hiringController.deleteCandidate);

// Export Live Excel File
router.get('/export-excel', hiringController.exportExcel);

module.exports = router;
