const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const whatsappWebService = require('./whatsappWeb.service');

function isWebProvider() {
  return (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase() === 'web';
}

const GRAPH_API_VERSION = 'v20.0';

/**
 * Format phone number to Meta E.164 string (no '+' sign, digits only)
 */
function formatPhoneNumber(phone) {
  let cleaned = String(phone).replace(/[^0-9]/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned; // Default country code if 10 digits
  }
  return cleaned;
}

/**
 * Get base URL for WhatsApp Graph API calls
 */
function getMessagesUrl() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
}

/**
 * Get authorization header
 */
function getHeaders() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Send request to Meta Graph API with comprehensive error handling
 */
async function postMetaGraph(url, payload) {
  try {
    const response = await axios.post(url, payload, { headers: getHeaders() });
    return response.data;
  } catch (err) {
    const metaError = err.response?.data?.error;
    if (metaError) {
      const errMsg = `Meta WhatsApp API error (${err.response.status}): ${metaError.message || JSON.stringify(metaError)} (Code: ${metaError.code || 'N/A'})`;
      console.error(`❌ ${errMsg}`);
      throw new Error(errMsg);
    }
    throw err;
  }
}

/**
 * Send text message via Meta WhatsApp Cloud API
 */
async function sendWhatsAppText(to, message, forceMeta = false) {
  if (!forceMeta && isWebProvider()) return whatsappWebService.sendWhatsAppText(to, message);
  const recipient = formatPhoneNumber(to);
  if (recipient.length > 13) {
    throw new Error(`Invalid phone number for Meta Cloud API: "+${recipient}" (looks like a WhatsApp Web LID: @lid, which Meta Cloud API cannot route to)`);
  }
  const url = getMessagesUrl();

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'text',
    text: {
      preview_url: false,
      body: message
    }
  };

  return postMetaGraph(url, payload);
}

/**
 * Send template message via Meta WhatsApp Cloud API
 */
async function sendWhatsAppTemplate(to, templateName, languageCode = 'en_US', components = []) {
  const recipient = formatPhoneNumber(to);
  if (recipient.length > 13) {
    throw new Error(`Invalid phone number for Meta Cloud API: "+${recipient}" (looks like a WhatsApp Web LID: @lid, which Meta Cloud API cannot route to)`);
  }
  const url = getMessagesUrl();

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: languageCode
      },
      components: components
    }
  };

  return postMetaGraph(url, payload);
}

/**
 * Upload local file to Meta Graph API Media endpoint
 */
async function uploadMediaToWhatsApp(filePath, mimeType) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/media`;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('file', fs.createReadStream(filePath));
  if (mimeType) {
    formData.append('type', mimeType);
  }

  const response = await axios.post(url, formData, {
    headers: {
      'Authorization': `Bearer ${token}`,
      ...formData.getHeaders()
    }
  });

  // Returns { id: "MEDIA_ID" }
  return response.data;
}

/**
 * Send Image message via Meta WhatsApp Cloud API
 */
async function sendWhatsAppImage(to, mediaIdOrUrl, caption = '') {
  const recipient = formatPhoneNumber(to);
  if (recipient.length > 13) {
    throw new Error(`Invalid phone number for Meta Cloud API: "+${recipient}" (looks like a WhatsApp Web LID: @lid, which Meta Cloud API cannot route to)`);
  }
  const url = getMessagesUrl();

  const imageObj = {};
  if (mediaIdOrUrl.startsWith('http://') || mediaIdOrUrl.startsWith('https://')) {
    imageObj.link = mediaIdOrUrl;
  } else {
    imageObj.id = mediaIdOrUrl;
  }
  if (caption) {
    imageObj.caption = caption;
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'image',
    image: imageObj
  };

  return postMetaGraph(url, payload);
}

/**
 * Send Document message via Meta WhatsApp Cloud API
 */
async function sendWhatsAppDocument(to, mediaIdOrUrl, filename = 'document.pdf', caption = '') {
  const recipient = formatPhoneNumber(to);
  if (recipient.length > 13) {
    throw new Error(`Invalid phone number for Meta Cloud API: "+${recipient}" (looks like a WhatsApp Web LID: @lid, which Meta Cloud API cannot route to)`);
  }
  const url = getMessagesUrl();

  const docObj = { filename };
  if (mediaIdOrUrl.startsWith('http://') || mediaIdOrUrl.startsWith('https://')) {
    docObj.link = mediaIdOrUrl;
  } else {
    docObj.id = mediaIdOrUrl;
  }
  if (caption) {
    docObj.caption = caption;
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'document',
    document: docObj
  };

  return postMetaGraph(url, payload);
}

/**
 * Send Video message via Meta WhatsApp Cloud API
 */
async function sendWhatsAppVideo(to, mediaIdOrUrl, caption = '') {
  const recipient = formatPhoneNumber(to);
  if (recipient.length > 13) {
    throw new Error(`Invalid phone number for Meta Cloud API: "+${recipient}" (looks like a WhatsApp Web LID: @lid, which Meta Cloud API cannot route to)`);
  }
  const url = getMessagesUrl();

  const videoObj = {};
  if (mediaIdOrUrl.startsWith('http://') || mediaIdOrUrl.startsWith('https://')) {
    videoObj.link = mediaIdOrUrl;
  } else {
    videoObj.id = mediaIdOrUrl;
  }
  if (caption) {
    videoObj.caption = caption;
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'video',
    video: videoObj
  };

  return postMetaGraph(url, payload);
}

/**
 * Check health / verification status of Meta Cloud API credentials
 */
async function checkMetaHealth() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return {
      configured: false,
      status: 'not_configured',
      message: 'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID missing in environment variables.'
    };
  }

  try {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}`;
    const response = await axios.get(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    return {
      configured: true,
      status: 'connected',
      phoneNumberId: phoneNumberId,
      displayPhoneNumber: response.data?.display_phone_number || phoneNumberId,
      verifiedName: response.data?.verified_name || 'Meta WhatsApp Account',
      qualityRating: response.data?.quality_rating || 'UNKNOWN'
    };
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    return {
      configured: true,
      status: 'error',
      message: `Meta API Error: ${errMsg}`,
      error: err.response?.data || err.message
    };
  }
}

/**
 * Download Media file from Meta Graph API (e.g. candidate resume PDF / image)
 */
async function downloadMediaFromWhatsApp(mediaId, destinationPath) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !mediaId) {
    throw new Error('Missing access token or media ID for downloading media');
  }

  // 1. Get the media download URL from Meta
  const metaUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`;
  const metaRes = await axios.get(metaUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const fileUrl = metaRes.data?.url;
  const mimeType = metaRes.data?.mime_type;
  if (!fileUrl) {
    throw new Error('Could not retrieve media download URL from Meta');
  }

  // Ensure destination directory exists
  const dir = path.dirname(destinationPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 2. Download the binary stream
  const response = await axios({
    method: 'GET',
    url: fileUrl,
    responseType: 'stream',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destinationPath);
    response.data.pipe(writer);
    writer.on('finish', () => resolve({ destinationPath, mimeType }));
    writer.on('error', reject);
  });
}

module.exports = {
  GRAPH_API_VERSION,
  formatPhoneNumber,
  sendWhatsAppText,
  sendWhatsAppTemplate,
  uploadMediaToWhatsApp,
  sendWhatsAppImage,
  sendWhatsAppDocument,
  sendWhatsAppVideo,
  downloadMediaFromWhatsApp,
  checkMetaHealth
};
