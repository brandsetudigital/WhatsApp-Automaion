const crypto = require('crypto');

// Bounded Set to track recently processed message IDs (up to 10,000 IDs)
const processedMessageIds = new Set();
const MAX_PROCESSED_IDS = 10000;

/**
 * Check if a WhatsApp Message ID has already been processed to prevent duplicates
 */
function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  if (processedMessageIds.has(messageId)) {
    return true;
  }
  // Add to set
  processedMessageIds.add(messageId);

  // Maintain max capacity
  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const firstKey = processedMessageIds.values().next().value;
    processedMessageIds.delete(firstKey);
  }
  return false;
}

/**
 * Verify Meta Webhook X-Hub-Signature-256
 */
function verifyWebhookSignature(req) {
  const appSecret = process.env.META_APP_SECRET;
  // If app secret is not configured in env, skip signature verification
  if (!appSecret) {
    return true;
  }

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    return false;
  }

  const elements = signature.split('=');
  const signatureHash = elements[1];
  const rawBody = req.rawBody || JSON.stringify(req.body);

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  return signatureHash === expectedHash;
}

/**
 * Safely parse incoming Meta Webhook payload
 */
function parseWebhookPayload(body) {
  if (!body || body.object !== 'whatsapp_business_account') {
    return null;
  }

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value || !value.messages || value.messages.length === 0) {
      return null; // May be a status update (delivered, read, sent)
    }

    const message = value.messages[0];
    const contact = value.contacts?.[0];

    const customerPhone = message.from; // International digits string e.g. "919876543210"
    const messageId = message.id;
    const messageType = message.type;
    const customerName = contact?.profile?.name || 'Customer';

    let messageText = '';
    let mediaId = null;
    let mediaFilename = null;
    let mimeType = null;

    if (messageType === 'text') {
      messageText = message.text?.body || '';
    } else if (messageType === 'image') {
      messageText = message.image?.caption || '[Image received]';
      mediaId = message.image?.id || null;
      mediaFilename = `image_${Date.now()}.jpg`;
      mimeType = message.image?.mime_type || 'image/jpeg';
    } else if (messageType === 'document') {
      messageText = message.document?.filename || message.document?.caption || '[Document received]';
      mediaId = message.document?.id || null;
      mediaFilename = message.document?.filename || `document_${Date.now()}.pdf`;
      mimeType = message.document?.mime_type || 'application/pdf';
    } else if (messageType === 'video') {
      messageText = message.video?.caption || '[Video received]';
      mediaId = message.video?.id || null;
      mediaFilename = `video_${Date.now()}.mp4`;
      mimeType = message.video?.mime_type || 'video/mp4';
    } else if (messageType === 'audio') {
      messageText = '[Audio message received]';
      mediaId = message.audio?.id || null;
      mimeType = message.audio?.mime_type || 'audio/ogg';
    } else if (messageType === 'button') {
      messageText = message.button?.text || '';
    } else if (messageType === 'interactive') {
      messageText = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
    } else {
      messageText = `[${messageType} message received]`;
    }

    return {
      customerPhone,
      messageId,
      messageType,
      messageText,
      customerName,
      mediaId,
      mediaFilename,
      mimeType,
      timestamp: message.timestamp
    };
  } catch (err) {
    console.error('Error parsing Meta Webhook payload:', err);
    return null;
  }
}

module.exports = {
  isDuplicateMessage,
  verifyWebhookSignature,
  parseWebhookPayload
};
