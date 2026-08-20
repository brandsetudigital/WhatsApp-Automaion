const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');

// Meta Webhook Verification (GET
router.get('/webhook', (req, res) => {
  whatsappController.verifyWebhook(req, res);
});

// Meta Webhook Notification Event Receiver (POST)
// Note: req.app.get('io') and processIncomingWhatsAppMessage will be passed from server.js
router.post('/webhook', (req, res) => {
  const io = req.app.get('io');
  const processIncomingFn = req.app.get('processIncomingWhatsAppMessage');
  whatsappController.handleWebhookEvent(req, res, io, processIncomingFn);
});

// Meta WhatsApp Cloud API Connection Status Health Check (GET)
router.get('/status', (req, res) => {
  whatsappController.getWhatsAppStatus(req, res);
});

module.exports = router;
