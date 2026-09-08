const { verifyWebhookSignature, parseWebhookPayload, isDuplicateMessage } = require('../utils/whatsappWebhook');
const whatsappCloudService = require('../services/whatsappCloud.service');
const whatsappWebService = require('../services/whatsappWeb.service');

/**
 * Handle Meta Webhook Verification (GET /api/whatsapp/webhook)
 */
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === expectedToken) {
      console.log('✅ Meta Webhook verification succeeded!');
      return res.status(200).send(challenge);
    } else {
      console.warn('❌ Meta Webhook verification failed. Token mismatch.');
      return res.status(403).json({ error: 'Verification token mismatch' });
    }
  }

  return res.status(400).json({ error: 'Missing hub parameters' });
}

// State management for per-user debouncing & sequential execution
const messageBuffers = new Map(); // phone -> { texts: string[], lastData: object, timer: NodeJS.Timeout }
const processingLock = new Set(); // phone -> true if in-flight async processing is running for this phone
const pendingQueues = new Map(); // phone -> { texts: string[], lastData: object }
const DEBOUNCE_WAIT_MS = 2000; // 2s debounce to capture multi-message typing bursts

async function executeBufferedMessage(phone, processIncomingFn) {
  const buf = messageBuffers.get(phone);
  messageBuffers.delete(phone);
  if (!buf) return;

  processingLock.add(phone);

  const combinedText = buf.texts.filter(Boolean).join('\n');
  buf.lastData.messageText = combinedText;

  try {
    if (typeof processIncomingFn === 'function') {
      await processIncomingFn(buf.lastData);
    }
  } catch (err) {
    console.error(`❌ Error processing WhatsApp message for +${phone}:`, err.message || err);
  } finally {
    processingLock.delete(phone);

    // If candidate sent new messages while we were busy processing, process them sequentially
    if (pendingQueues.has(phone)) {
      const pending = pendingQueues.get(phone);
      pendingQueues.delete(phone);
      messageBuffers.set(phone, {
        texts: pending.texts,
        lastData: pending.lastData,
        timer: setTimeout(() => {
          executeBufferedMessage(phone, processIncomingFn);
        }, 1200)
      });
    }
  }
}

/**
 * Handle Meta Webhook Event Notifications (POST /api/whatsapp/webhook)
 */
function handleWebhookEvent(req, res, io, processIncomingFn) {
  // 1. Send HTTP 200 response immediately to Meta to avoid retries
  res.status(200).send('EVENT_RECEIVED');

  // 2. Signature verification
  if (!verifyWebhookSignature(req)) {
    console.warn('⚠️ Incoming Meta Webhook signature verification failed.');
    return;
  }

  // 3. Parse Webhook payload
  const messageData = parseWebhookPayload(req.body);
  if (!messageData) {
    return; // Event was not an incoming message (e.g. status update)
  }

  console.log(`📩 Incoming Webhook message from +${messageData.customerPhone} (${messageData.customerName}): "${messageData.messageText}"`);

  // 4. Duplicate prevention
  if (isDuplicateMessage(messageData.messageId)) {
    console.log(`ℹ️ Ignored duplicate message ID: ${messageData.messageId}`);
    return;
  }

  // 5. Debounce & Batch Rapid Consecutive Messages from the same sender
  const phone = messageData.customerPhone;

  // If already processing for this phone, buffer incoming message into pendingQueue
  if (processingLock.has(phone)) {
    console.log(`⏳ Message buffered for +${phone} (processing already in progress)`);
    if (!pendingQueues.has(phone)) {
      pendingQueues.set(phone, {
        texts: [messageData.messageText],
        lastData: { ...messageData, source: 'meta' }
      });
    } else {
      const q = pendingQueues.get(phone);
      q.texts.push(messageData.messageText);
      q.lastData = { ...messageData, source: 'meta' };
    }
    return;
  }

  // Otherwise, debounce incoming messages
  if (!messageBuffers.has(phone)) {
    messageBuffers.set(phone, {
      texts: [messageData.messageText],
      lastData: { ...messageData, source: 'meta' },
      timer: null
    });
  } else {
    const buf = messageBuffers.get(phone);
    if (buf.timer) clearTimeout(buf.timer);
    buf.texts.push(messageData.messageText);
    buf.lastData = { ...messageData, source: 'meta' };
  }

  const userBuf = messageBuffers.get(phone);
  userBuf.timer = setTimeout(() => {
    executeBufferedMessage(phone, processIncomingFn);
  }, DEBOUNCE_WAIT_MS);
}

/**
 * Get WhatsApp API Connection & Health Status (GET /api/whatsapp/status)
 */
async function getWhatsAppStatus(req, res) {
  try {
    if ((process.env.WHATSAPP_PROVIDER || 'web').toLowerCase() === 'web') {
      return res.json({ success: true, ...whatsappWebService.getStatus() });
    }
    const health = await whatsappCloudService.checkMetaHealth();
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const maskedPhoneId = phoneId ? `${phoneId.substring(0, 4)}...${phoneId.substring(phoneId.length - 4)}` : '';

    res.json({
      success: true,
      provider: 'meta',
      configured: health.configured,
      phoneNumberId: maskedPhoneId,
      status: health.status,
      displayPhoneNumber: health.displayPhoneNumber || '',
      verifiedName: health.verifiedName || '',
      qualityRating: health.qualityRating || '',
      message: health.message || ''
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      provider: 'meta',
      configured: false,
      status: 'error',
      error: err.message
    });
  }
}

module.exports = {
  verifyWebhook,
  handleWebhookEvent,
  getWhatsAppStatus
};
