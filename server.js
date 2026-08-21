require('dotenv').config();

const crypto = require('crypto');
if (!global.crypto) {
  global.crypto = crypto.webcrypto || crypto;
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const csvParser = require('csv-parser');
const xlsx = require('xlsx');

// Import Custom Services & Modules
const whatsappCloudService = require('./services/whatsappCloud.service');
const aiService = require('./services/ai.service');
const hiringService = require('./services/hiring.service');
const whatsappRoutes = require('./routes/whatsapp.routes');
const hiringRoutes = require('./routes/hiring.routes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Save io instance on app for route access
app.set('io', io);

app.use(cors());

// ⭐ CRITICAL: Use express.raw() for webhook to capture raw body
app.use('/api/whatsapp/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  const rawBody = req.body.toString('utf8');
  req.rawBody = rawBody;
  try {
    req.body = JSON.parse(rawBody);
  } catch (e) {
    req.body = {};
  }
  next();
});

// For all other routes, use express.json()
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



app.use(express.static(path.join(__dirname)));

// Configure file uploads for media and CSV/Excel files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`);
  }
});
const upload = multer({ storage });

// Initialize Hiring Service with Socket IO
hiringService.setHiringIo(io);

// Application State
let activeCampaign = {
  running: false,
  total: 0,
  sent: 0,
  failed: 0,
  logs: []
};

// Load Auto Reply Rules from JSON
let autoReplyRules = [];
const RULES_FILE = path.join(__dirname, 'auto_replies.json');
if (fs.existsSync(RULES_FILE)) {
  try {
    autoReplyRules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  } catch (err) {
    console.error('Error loading auto_replies.json:', err);
  }
}

function saveAutoReplies() {
  fs.writeFileSync(RULES_FILE, JSON.stringify(autoReplyRules, null, 2));
}

/**
 * Process Incoming WhatsApp Messages (Webhook Core Workflow)
 */
async function processIncomingWhatsAppMessage(messageData) {
  const { customerPhone, customerName, messageText, messageId } = messageData;

  console.log(`📩 Webhook message received from +${customerPhone} (${customerName}): "${messageText}"`);

  io.emit('log', {
    type: 'info',
    text: `📩 Webhook message from +${customerPhone} (${customerName}): "${messageText}"`
  });

  // 0. Check for HR WhatsApp Action Commands (e.g. "Select 9876543210", "Reject 9876543210", "Hold 9876543210")
  try {
    const hrCommandResult = await hiringService.handleHrWhatsAppCommand(customerPhone, messageText);
    if (hrCommandResult) {
      console.log(`👮 HR WhatsApp Command executed from +${customerPhone}: "${messageText}"`);
      await whatsappCloudService.sendWhatsAppText(customerPhone, hrCommandResult);
      io.emit('log', {
        type: 'success',
        text: `👮 HR Command executed: ${messageText}`
      });
      return; // Handled as HR command, skip candidate flow!
    }
  } catch (hrErr) {
    console.error('Error handling HR WhatsApp command:', hrErr.message);
  }

  // 1. Automatically track candidate in Hiring CRM and sync to Excel
  let candidate = null;
  try {
    candidate = hiringService.trackCandidateFromMessage(messageData);

    // If candidate sent a media file (PDF resume, document, image)
    if (candidate && messageData.mediaId) {
      const resumesDir = path.join(__dirname, 'uploads', 'resumes');
      const safeName = (messageData.mediaFilename || `resume_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const uniqueFileName = `${candidate.phone}_${Date.now()}_${safeName}`;
      const destPath = path.join(resumesDir, uniqueFileName);

      console.log(`📥 Downloading candidate media (${messageData.mediaId}) -> ${destPath}...`);
      whatsappCloudService.downloadMediaFromWhatsApp(messageData.mediaId, destPath)
        .then(() => {
          candidate.resumeReceived = true;
          candidate.resumeFileName = safeName;
          candidate.resumePath = destPath;
          candidate.resumeUrl = `/uploads/resumes/${uniqueFileName}`;
          if (candidate.status === 'Applied' || candidate.status === 'Resume Pending') {
            candidate.status = 'Resume Received';
          }
          hiringService.saveCandidatesAndSyncExcel();
          console.log(`✅ Candidate resume file saved: ${uniqueFileName}`);
          io.emit('log', {
            type: 'success',
            text: `📄 Resume saved for ${candidate.name} (+${candidate.phone}): ${safeName}`
          });
        })
        .catch(dlErr => {
          console.error('Error downloading candidate media:', dlErr.message);
        });
    }
  } catch (candErr) {
    console.error('Error tracking candidate from message:', candErr);
  }

  // 2. Check for Automatic Interview Scheduling Intent if candidate is active
  let interviewScheduledNow = false;
  if (candidate && messageText && messageText.length > 2) {
    try {
      const scheduleIntent = await aiService.parseInterviewScheduleWithGemini(messageText, candidate);
      if (scheduleIntent && scheduleIntent.isScheduling && scheduleIntent.proposedDateTimeIso) {
        console.log(`📅 Automatic Interview Schedule detected for ${candidate.name} (+${candidate.phone}): ${scheduleIntent.proposedDateTimeIso}`);
        
        await hiringService.scheduleInterview(
          candidate.id,
          scheduleIntent.proposedDateTimeIso,
          candidate.role,
          `Auto-scheduled via WhatsApp AI: "${messageText}"`,
          true // Sends official English confirmation message
        );
        interviewScheduledNow = true;
        return; // Confirmation already sent by scheduleInterview!
      }
    } catch (schedErr) {
      console.error('Error during auto interview schedule check:', schedErr.message);
    }
  }

  // 3. Check Auto Reply Rules (For specific exact questions or general FAQs)
  let matchedStaticRule = false;
  for (const rule of autoReplyRules) {
    let isMatch = false;
    const triggers = rule.trigger.split(',').map(t => t.toLowerCase().trim()).filter(Boolean);
    const incomingText = (messageText || '').toLowerCase().trim();
    const cleanIncoming = incomingText.replace(/[^\w\s]/g, '').trim();

    for (const trigger of triggers) {
      const cleanTrigger = trigger.replace(/[^\w\s]/g, '').trim();

      if (rule.matchType === 'exact') {
        if (incomingText === trigger || cleanIncoming === cleanTrigger) {
          isMatch = true;
          break;
        }
      } else if (rule.matchType === 'contains') {
        if (incomingText.includes(trigger) || cleanIncoming.includes(cleanTrigger)) {
          isMatch = true;
          break;
        }
      } else if (rule.matchType === 'starts_with') {
        if (incomingText.startsWith(trigger) || cleanIncoming.startsWith(cleanTrigger)) {
          isMatch = true;
          break;
        }
      }
    }

    if (isMatch) {
      matchedStaticRule = true;
      console.log(`🤖 Auto-reply triggered by rule "${rule.trigger}" for +${customerPhone}`);
      io.emit('log', {
        type: 'info',
        text: `Static rule triggered for +${customerPhone} (Trigger: "${rule.trigger}")`
      });

      try {
        const sendResult = await whatsappCloudService.sendWhatsAppText(customerPhone, rule.replyText);
        if (candidate) {
          hiringService.appendChatHistory(candidate, 'assistant', rule.replyText);
        }
        console.log(`✅ Auto-reply sent successfully to +${customerPhone}:`, sendResult);

        // Send media attachment if rule specifies one
        if (rule.attachmentPath && fs.existsSync(rule.attachmentPath)) {
          try {
            const ext = path.extname(rule.attachmentPath).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            const mimeType = isImage ? `image/${ext.replace('.', '')}` : 'application/pdf';

            const uploadRes = await whatsappCloudService.uploadMediaToWhatsApp(rule.attachmentPath, mimeType);
            if (uploadRes?.id) {
              if (isImage) {
                await whatsappCloudService.sendWhatsAppImage(customerPhone, uploadRes.id, 'Attachment');
              } else {
                await whatsappCloudService.sendWhatsAppDocument(
                  customerPhone,
                  uploadRes.id,
                  rule.attachmentName || 'document.pdf',
                  'Attachment'
                );
              }
            }
          } catch (mediaErr) {
            console.error('Error sending static rule attachment:', mediaErr.message);
            io.emit('log', {
              type: 'error',
              text: `Failed to upload rule attachment: ${mediaErr.message}`
            });
          }
        }

        io.emit('log', {
          type: 'success',
          text: `✅ Auto-reply sent to +${customerPhone}`
        });
      } catch (sendErr) {
        console.error('❌ Error sending auto-reply to +${customerPhone}:', sendErr.message);
        io.emit('log', {
          type: 'error',
          text: `❌ Failed to send auto-reply to +${customerPhone}: ${sendErr.message}`
        });
      }

      break;
    }
  }

  // 4. If no static rule matched and AI is ENABLED
  const aiConfig = aiService.getAiConfig();
  if (!matchedStaticRule && aiConfig.enabled) {
    try {
      console.log(`🤖 Generating Gemini AI response for +${customerPhone}...`);
      io.emit('log', {
        type: 'info',
        text: `🤖 Gemini AI processing message from +${customerPhone}: "${messageText}"`
      });

      // Pass full candidate profile and history to AI
      const aiResponseText = candidate
        ? await aiService.generateHiringAIResponse(candidate, messageText, messageData)
        : await aiService.generateAIResponse(messageText);

      // Send AI response via Meta Cloud API
      await whatsappCloudService.sendWhatsAppText(customerPhone, aiResponseText);

      if (candidate) {
        hiringService.appendChatHistory(candidate, 'assistant', aiResponseText);
        hiringService.saveCandidatesAndSyncExcel();
      }

      console.log(`✅ AI response sent to +${customerPhone}: "${aiResponseText.substring(0, 60)}..."`);
      io.emit('log', {
        type: 'success',
        text: `🤖 AI Assistant replied to +${customerPhone}: "${aiResponseText.substring(0, 60)}..."`
      });
    } catch (aiErr) {
      console.error('❌ Error processing AI response for +${customerPhone}:', aiErr.message);
      io.emit('log', {
        type: 'error',
        text: `❌ AI Chatbot error for +${customerPhone}: ${aiErr.message}`
      });
    }
  }
}

// Pass processIncomingWhatsAppMessage to app context for webhook route access
app.set('processIncomingWhatsAppMessage', processIncomingWhatsAppMessage);

// Mount Meta WhatsApp Cloud API & Hiring Routes
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/hiring', hiringRoutes);

// Socket.io Realtime Events
io.on('connection', async (socket) => {
  try {
    const health = await whatsappCloudService.checkMetaHealth();
    socket.emit('status-update', {
      provider: 'meta',
      status: health.status,
      configured: health.configured,
      userInfo: {
        name: health.verifiedName || 'Meta WhatsApp Account',
        phoneNumber: health.displayPhoneNumber || health.phoneNumberId || 'WhatsApp Cloud API'
      }
    });
  } catch (e) {
    socket.emit('status-update', { provider: 'meta', status: 'not_configured' });
  }

  socket.emit('campaign-progress', activeCampaign);
  socket.emit('hiring:update', {
    candidates: hiringService.getCandidates(),
    stats: hiringService.getHiringStats()
  });
});

// REST API Endpoints

// AI Chatbot Configuration Endpoints
app.get('/api/ai-config', (req, res) => {
  res.json({
    success: true,
    config: aiService.getAiConfig()
  });
});

app.post('/api/ai-config', (req, res) => {
  try {
    const updatedConfig = aiService.updateAiConfig(req.body);
    res.json({
      success: true,
      message: 'AI configuration updated successfully',
      config: updatedConfig
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ai-test', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  try {
    const aiResponse = await aiService.generateAIResponse(message);
    res.json({ success: true, userMessage: message, aiResponse });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset Connection / Health Re-Check (Logout Endpoint Replacement)
app.post('/api/logout', async (req, res) => {
  try {
    const health = await whatsappCloudService.checkMetaHealth();
    io.emit('status-update', {
      provider: 'meta',
      status: health.status,
      configured: health.configured,
      userInfo: {
        name: health.verifiedName || 'Meta WhatsApp Account',
        phoneNumber: health.displayPhoneNumber || ''
      }
    });
    res.json({ success: true, message: 'Session status refreshed', health });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload CSV / Excel File and parse contacts
app.post('/api/upload-csv', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  const contacts = [];
  let columns = [];

  try {
    if (ext === '.csv') {
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('headers', (headers) => {
          columns = headers.map(h => h.trim());
        })
        .on('data', (row) => {
          contacts.push(row);
        })
        .on('end', () => {
          fs.unlinkSync(filePath);
          res.json({ success: true, count: contacts.length, columns, contacts });
        })
        .on('error', (err) => {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          res.status(500).json({ success: false, error: err.message });
        });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });

      if (data.length > 0) {
        columns = Object.keys(data[0]);
      }
      fs.unlinkSync(filePath);
      res.json({ success: true, count: data.length, columns, contacts: data });
    } else {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, error: 'Unsupported file format. Please upload CSV or XLSX.' });
    }
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auto-Reply Rules Endpoints
app.get('/api/auto-replies', (req, res) => {
  res.json({ success: true, rules: autoReplyRules });
});

app.post('/api/auto-replies', upload.single('attachment'), (req, res) => {
  const { trigger, matchType, replyText } = req.body;
  if (!trigger || !replyText) {
    return res.status(400).json({ success: false, error: 'Trigger and reply text are required' });
  }

  const newRule = {
    id: Date.now().toString(),
    trigger,
    matchType: matchType || 'contains',
    replyText,
    attachmentPath: req.file ? req.file.path : null,
    attachmentName: req.file ? req.file.originalname : null
  };

  autoReplyRules.push(newRule);
  saveAutoReplies();
  res.json({ success: true, rule: newRule });
});

app.delete('/api/auto-replies/:id', (req, res) => {
  const { id } = req.params;
  autoReplyRules = autoReplyRules.filter(r => r.id !== id);
  saveAutoReplies();
  res.json({ success: true, message: 'Rule deleted' });
});

// Bulk Messaging Endpoint (Updated to Meta WhatsApp Cloud API)
app.post('/api/send-bulk', upload.single('media'), async (req, res) => {
  const health = await whatsappCloudService.checkMetaHealth();
  if (!health.configured || health.status === 'not_configured') {
    return res.status(400).json({
      success: false,
      error: 'Meta WhatsApp Cloud API is not configured. Please set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env.'
    });
  }

  if (activeCampaign.running) {
    return res.status(400).json({ success: false, error: 'A campaign is already running.' });
  }

  let { recipients, templateText, templateName, languageCode, minDelay, maxDelay } = req.body;

  try {
    if (typeof recipients === 'string') {
      recipients = JSON.parse(recipients);
    }
  } catch (e) {
    return res.status(400).json({ success: false, error: 'Invalid recipients format.' });
  }

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid recipients provided.' });
  }

  minDelay = parseInt(minDelay) || 2;
  maxDelay = parseInt(maxDelay) || 5;

  const mediaPath = req.file ? req.file.path : null;
  const mediaName = req.file ? req.file.originalname : null;

  // Pre-upload media if present
  let uploadedMediaId = null;
  let isImage = false;
  if (mediaPath && fs.existsSync(mediaPath)) {
    try {
      const ext = path.extname(mediaPath).toLowerCase();
      isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
      const mimeType = isImage ? `image/${ext.replace('.', '')}` : 'application/pdf';

      const uploadRes = await whatsappCloudService.uploadMediaToWhatsApp(mediaPath, mimeType);
      uploadedMediaId = uploadRes?.id;
      io.emit('log', { type: 'info', text: `📎 Attachment uploaded to Meta Cloud (Media ID: ${uploadedMediaId})` });
    } catch (uploadErr) {
      console.error('Error uploading campaign media:', uploadErr.message);
      return res.status(500).json({ success: false, error: `Media upload failed: ${uploadErr.message}` });
    }
  }

  // Initialize Active Campaign State
  activeCampaign = {
    running: true,
    total: recipients.length,
    sent: 0,
    failed: 0,
    logs: []
  };

  res.json({ success: true, message: 'Campaign started successfully via Meta WhatsApp Cloud API', total: recipients.length });

  // Run Bulk Queue Asynchronously
  (async () => {
    io.emit('log', { type: 'info', text: `🚀 Starting Meta Cloud API bulk campaign for ${recipients.length} contacts...` });

    for (let i = 0; i < recipients.length; i++) {
      if (!activeCampaign.running) {
        io.emit('log', { type: 'warning', text: '🛑 Campaign stopped by user.' });
        break;
      }

      const item = recipients[i];
      let phone = item.phone || item.Phone || item.mobile || item.Mobile || item.number || item.Number || item.contact || item.Contact || item;
      phone = String(phone).replace(/[^0-9]/g, '');

      
      if (!phone || phone.length < 8) {
        activeCampaign.failed++;
        const failMsg = `[Row ${i + 1}] Invalid Phone Number: "${phone}"`;
        activeCampaign.logs.push({ time: new Date().toLocaleTimeString(), type: 'error', text: failMsg });
        io.emit('campaign-progress', activeCampaign);
        io.emit('log', { type: 'error', text: failMsg });
        continue;
      }

      if (phone.length === 10) {
        phone = '91' + phone;
      }

      // Variable replacement for text
      let messageContent = templateText || '';
      if (typeof item === 'object') {
        Object.keys(item).forEach((key) => {
          const regex = new RegExp(`\\{${key.trim()}\\}`,'gi');
          messageContent = messageContent.replace(regex, item[key]);
        });
      }

      try {
        if (templateName) {
          // Send Approved Meta Template Message
          await whatsappCloudService.sendWhatsAppTemplate(phone, templateName, languageCode || 'en_US');
        } else if (uploadedMediaId) {
          // Send Media Message with Caption
          if (isImage) {
            await whatsappCloudService.sendWhatsAppImage(phone, uploadedMediaId, messageContent);
          } else {
            await whatsappCloudService.sendWhatsAppDocument(phone, uploadedMediaId, mediaName || 'document.pdf', messageContent);
          }
        } else {
          // Send Text Message
          await whatsappCloudService.sendWhatsAppText(phone, messageContent);
        }

        activeCampaign.sent++;
        const logMsg = `[${i + 1}/${recipients.length}] Sent message to +${phone}`;
        activeCampaign.logs.push({ time: new Date().toLocaleTimeString(), type: 'success', text: logMsg });
        io.emit('campaign-progress', activeCampaign);
        io.emit('log', { type: 'success', text: logMsg });

      } catch (err) {
        activeCampaign.failed++;
        const errMsg = err.response?.data?.error?.message || err.message;
        const failMsg = `[${i + 1}/${recipients.length}] Failed to send to +${phone}: ${errMsg}`;
        activeCampaign.logs.push({ time: new Date().toLocaleTimeString(), type: 'error', text: failMsg });
        io.emit('campaign-progress', activeCampaign);
        io.emit('log', { type: 'error', text: failMsg });
      }

      // Small rate-limit delay between Meta API calls
      if (i < recipients.length - 1 && activeCampaign.running) {
        const delaySeconds = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        await new Promise(r => setTimeout(r, delaySeconds * 1000));
      }
    }

    activeCampaign.running = false;
    io.emit('campaign-progress', activeCampaign);
    io.emit('log', {
      type: 'info',
      text: `🎉 Campaign completed! Total: ${activeCampaign.total}, Sent: ${activeCampaign.sent}, Failed: ${activeCampaign.failed}`
    });
  })();
});

// Stop active campaign
app.post('/api/stop-campaign', (req, res) => {
  if (activeCampaign.running) {
    activeCampaign.running = false;
    res.json({ success: true, message: 'Campaign stop requested' });
  } else {
    res.json({ success: false, error: 'No campaign running' });
  }
});

server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 Meta WhatsApp Cloud API Server running on port ${PORT}!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`===================================================`);
});
