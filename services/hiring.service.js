const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const whatsappCloudService = require('./whatsappCloud.service');

const CANDIDATES_JSON_FILE = path.join(__dirname, '..', 'candidates_data.json');
const CANDIDATES_EXCEL_FILE = path.join(__dirname, '..', 'candidates_hiring.xlsx');

let candidates = [];
let ioInstance = null;

function setHiringIo(io) {
  ioInstance = io;
}

/**
 * Load candidates from JSON storage
 */
function loadCandidates() {
  if (fs.existsSync(CANDIDATES_JSON_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CANDIDATES_JSON_FILE, 'utf8'));
      if (Array.isArray(data)) {
        candidates = data;
      }
    } catch (err) {
      console.error('Error reading candidates_data.json:', err);
      candidates = [];
    }
  } else {
    candidates = [];
  }
}

/**
 * Save candidates to JSON and generate Excel file
 */
function saveCandidatesAndSyncExcel() {
  try {
    // 1. Save JSON
    fs.writeFileSync(CANDIDATES_JSON_FILE, JSON.stringify(candidates, null, 2));

    // 2. Format data for Excel Export
    const excelRows = candidates.map((c, index) => {
      let interviewFormatted = 'Not Scheduled';
      if (c.interviewDateTime) {
        try {
          const d = new Date(c.interviewDateTime);
          interviewFormatted = d.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short'
          });
        } catch (e) {
          interviewFormatted = c.interviewDateTime;
        }
      }

      let appliedOnFormatted = '';
      if (c.createdAt) {
        try {
          appliedOnFormatted = new Date(c.createdAt).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short'
          });
        } catch (e) {
          appliedOnFormatted = c.createdAt;
        }
      }

      return {
        'S.No': index + 1,
        'Candidate Name': c.name || 'Candidate',
        'WhatsApp Phone': c.phone ? `+${c.phone}` : '',
        'Role Applied': c.role || 'Not Specified',
        'Resume Received': c.resumeReceived ? 'YES' : 'PENDING',
        'Portfolio / Drive Link': c.portfolio || '',
        'Candidate Status': c.status || 'Applied',
        'Interview Date & Time': interviewFormatted,
        'Experience': c.experience || '',
        'City': c.city || 'Indore',
        'Resume Reminder Sent': c.resumeReminderSent ? 'YES' : 'NO',
        'Interview 1hr Reminder': c.interviewReminderSent ? 'YES' : 'NO',
        'Applied Date': appliedOnFormatted,
        'Last Message': c.lastMessage || '',
        'Notes': c.notes || ''
      };
    });

    // 3. Create Excel Workbook and Sheet
    const worksheet = xlsx.utils.json_to_sheet(excelRows);
    
    // Set column widths for clean readability in Excel
    worksheet['!cols'] = [
      { wch: 6 },  // S.No
      { wch: 20 }, // Name
      { wch: 18 }, // Phone
      { wch: 18 }, // Role
      { wch: 16 }, // Resume Received
      { wch: 30 }, // Portfolio Link
      { wch: 20 }, // Status
      { wch: 24 }, // Interview Date & Time
      { wch: 14 }, // Experience
      { wch: 14 }, // City
      { wch: 22 }, // Resume Reminder
      { wch: 22 }, // Interview Reminder
      { wch: 22 }, // Applied Date
      { wch: 30 }, // Last Message
      { wch: 25 }  // Notes
    ];

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Candidates Hiring');
    xlsx.writeFile(workbook, CANDIDATES_EXCEL_FILE);

    // Notify UI via socket
    if (ioInstance) {
      ioInstance.emit('hiring:update', { candidates, stats: getHiringStats() });
    }
  } catch (err) {
    console.error('Error saving candidates and sync excel:', err);
  }
}

// Initial Load
loadCandidates();
saveCandidatesAndSyncExcel();

/**
 * Get Hiring Pipeline Statistics
 */
function getHiringStats() {
  const total = candidates.length;
  const resumePending = candidates.filter(c => !c.resumeReceived).length;
  const resumeReceived = candidates.filter(c => c.resumeReceived).length;
  const interviewScheduled = candidates.filter(c => c.status === 'Interview Scheduled' && c.interviewDateTime).length;
  
  // Count interviews scheduled for today
  const todayStr = new Date().toISOString().split('T')[0];
  const scheduledToday = candidates.filter(c => {
    if (!c.interviewDateTime) return false;
    return c.interviewDateTime.startsWith(todayStr);
  }).length;

  const completed = candidates.filter(c => c.status === 'Completed' || c.status === 'Selected').length;

  return {
    total,
    resumePending,
    resumeReceived,
    interviewScheduled,
    scheduledToday,
    completed
  };
}

/**
 * Format Phone to standard digits
 */
function cleanPhone(phone) {
  let cleaned = String(phone || '').replace(/[^0-9]/g, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  return cleaned;
}

/**
 * Add message to candidate chat history
 */
function appendChatHistory(candidate, role, text) {
  if (!candidate.chatHistory) {
    candidate.chatHistory = [];
  }
  candidate.chatHistory.push({
    role: role, // 'user' | 'assistant'
    text: String(text || '').trim(),
    timestamp: new Date().toISOString()
  });

  // Keep last 20 messages for memory efficiency
  if (candidate.chatHistory.length > 20) {
    candidate.chatHistory = candidate.chatHistory.slice(-20);
  }
}

/**
 * Helper to get clean candidate first or display name
 */
function getCandidateDisplayName(candidate) {
  if (!candidate) return 'Candidate';
  let name = (candidate.name || '').trim();
  if (!name || name.toLowerCase() === 'customer' || name.toLowerCase() === 'candidate') {
    return 'Candidate';
  }
  // Return first name or full name cleanly
  return name;
}

/**
 * Handle incoming message for Candidate Tracking & State Management
 */
function trackCandidateFromMessage(messageData) {
  const phone = cleanPhone(messageData.customerPhone);
  if (!phone) return null;

  const text = String(messageData.messageText || '').trim();
  const lower = text.toLowerCase().trim();
  const msgType = messageData.messageType;

  let candidate = candidates.find(c => c.phone === phone);
  const nowIso = new Date().toISOString();

  // Extract drive / portfolio / doc link if present
  let extractedLink = '';
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/gi);
  if (urlMatch && urlMatch.length > 0) {
    extractedLink = urlMatch[0];
  }

  // Strict Resume / Portfolio signal check:
  // ONLY true if actual media/document uploaded OR actual portfolio/drive URL provided
  const hasValidDocumentUpload = (msgType === 'document' || msgType === 'image');
  const hasPortfolioLink = (
    lower.includes('drive.google.com') ||
    lower.includes('docs.google.com') ||
    lower.includes('behance.net') ||
    lower.includes('github.com') ||
    lower.includes('linkedin.com/in') ||
    lower.includes('dribbble.com') ||
    lower.includes('notion.site') ||
    lower.includes('dropbox.com') ||
    lower.includes('.pdf') ||
    lower.includes('.docx') ||
    lower.includes('.doc')
  );

  const hasResumeSignal = hasValidDocumentUpload || hasPortfolioLink;

  // Detect role
  let detectedRole = null;
  if (lower.includes('seo') || lower.includes('search engine') || lower.includes('ranking') || lower.includes('on-page') || lower.includes('off-page')) {
    detectedRole = 'SEO Expert';
  } else if (lower.includes('video') || lower.includes('editor') || lower.includes('reels') || lower.includes('premiere') || lower.includes('after effects') || lower.includes('davinci')) {
    detectedRole = 'Video Editor';
  }

  // Detect Candidate Name if sent in message (e.g. "My name is Arjun", "Mera naam Arjun hai", "I am Arjun Meena", "Name: Arjun")
  let extractedName = null;
  const namePattern = /(?:my name is|mera naam|i am|name\s*[:=-]?)\s+([A-Za-z\s]{2,25}?)(?:\r?\n|,\s*|\s+(?:role|apply|for|mobile|phone|exp|city|$))/i;
  const nameMatch = text.match(namePattern);
  if (nameMatch && nameMatch[1]) {
    const rawN = nameMatch[1].trim();
    if (rawN.length >= 2 && !['here', 'applying', 'seo', 'video', 'expert', 'editor', 'is', 'am'].includes(rawN.toLowerCase())) {
      extractedName = rawN;
    }
  } else {
    // Simple line-based fallback check e.g. "Name: Arjun Meena"
    const simpleNameMatch = text.match(/(?:my name is|mera naam|i am|name\s*[:=-]?)\s+([A-Za-z\s]{2,25})/i);
    if (simpleNameMatch && simpleNameMatch[1]) {
      const rawN = simpleNameMatch[1].split(/\r?\n/)[0].replace(/\b(role|for|apply|seo|editor).*/i, '').trim();
      if (rawN.length >= 2) {
        extractedName = rawN;
      }
    }
  }

  // Fallback to WhatsApp profile name if valid
  const rawCustomerName = (messageData.customerName || '').trim();
  const validProfileName = (rawCustomerName && rawCustomerName.toLowerCase() !== 'customer' && rawCustomerName.toLowerCase() !== 'user')
    ? rawCustomerName
    : null;

  const initialName = extractedName || validProfileName || 'Candidate';

  if (!candidate) {
    candidate = {
      id: `cand_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      phone: phone,
      name: initialName,
      role: detectedRole || 'General Applicant',
      city: 'Indore',
      experience: '',
      portfolio: extractedLink,
      resumeReceived: hasResumeSignal,
      resumeFileName: msgType === 'document' ? (messageData.messageText || 'Resume Document') : (hasResumeSignal ? 'Portfolio Link' : ''),
      status: hasResumeSignal ? 'Resume Received' : 'Applied',
      interviewDateTime: null,
      notes: '',
      resumeReminderSent: false,
      resumeReminderSentAt: null,
      interviewReminderSent: false,
      interviewReminderSentAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastMessage: text,
      chatHistory: []
    };
    appendChatHistory(candidate, 'user', text);
    candidates.unshift(candidate);
    console.log(`📋 New Candidate Registered: ${candidate.name} (+${candidate.phone}) for ${candidate.role}`);
  } else {
    // Update existing candidate
    candidate.updatedAt = nowIso;
    candidate.lastMessage = text;
    appendChatHistory(candidate, 'user', text);

    if (extractedName) {
      candidate.name = extractedName;
    } else if (validProfileName && (candidate.name === 'Candidate' || candidate.name === 'Customer' || !candidate.name)) {
      candidate.name = validProfileName;
    }

    if (detectedRole && (candidate.role === 'General Applicant' || !candidate.role)) {
      candidate.role = detectedRole;
    }

    if (extractedLink) {
      candidate.portfolio = extractedLink;
    }

    if (hasResumeSignal && !candidate.resumeReceived) {
      candidate.resumeReceived = true;
      candidate.resumeFileName = msgType === 'document' ? (messageData.messageText || 'Resume Document') : 'Portfolio Link';
      if (candidate.status === 'Applied' || candidate.status === 'Resume Pending') {
        candidate.status = 'Resume Received';
      }
      console.log(`📄 Resume / Portfolio Received from candidate: ${candidate.name} (+${candidate.phone})`);
    }
  }

  saveCandidatesAndSyncExcel();
  return candidate;
}

/**
 * Schedule Interview for Candidate & Send WhatsApp Confirmation
 */
async function scheduleInterview(candidateId, interviewDateTime, role, notes = '', sendInstantConfirmation = true) {
  const candidate = candidates.find(c => c.id === candidateId || c.phone === cleanPhone(candidateId));
  if (!candidate) {
    throw new Error('Candidate not found');
  }

  const interviewDate = new Date(interviewDateTime);
  if (isNaN(interviewDate.getTime())) {
    throw new Error('Invalid interview date & time');
  }

  const isRescheduled = !!candidate.interviewDateTime;
  candidate.interviewDateTime = interviewDate.toISOString();
  candidate.status = 'Interview Scheduled';
  candidate.interviewReminderSent = false; // Reset 1-hr reminder for new schedule
  candidate.interviewReminderSentAt = null;
  if (role && role !== 'General Applicant') candidate.role = role;
  if (notes) candidate.notes = notes;
  candidate.updatedAt = new Date().toISOString();

  saveCandidatesAndSyncExcel();

  // Send Instant Confirmation Message to candidate (in professional English)
  if (sendInstantConfirmation) {
    try {
      const formattedTime = interviewDate.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      const confirmMsg = isRescheduled
        ? `Dear ${candidate.name}! 🔄\n\nYour interview for the *${candidate.role || 'Job'}* position at *BrandSetu Digital* has been *rescheduled successfully*.\n\n📅 *Updated Date & Time:* ${formattedTime}\n📍 *Office Address:* 103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n📌 Please bring your updated Resume and work samples/portfolio.\n\nFor any questions or directions, reply here or contact us at +91 9329232025.\n\nSee you then! 👍\n- HR Team, BrandSetu Digital`
        : `Dear ${candidate.name}! 🎉\n\nYour interview for the *${candidate.role || 'Job'}* position at *BrandSetu Digital* has been scheduled successfully.\n\n📅 *Date & Time:* ${formattedTime}\n📍 *Office Address:* 103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n📌 Please bring your updated Resume and work samples/portfolio.\n\nFor any questions or directions, reply here or contact us at +91 9329232025.\n\nBest of luck! 👍\n- HR Team, BrandSetu Digital`;

      await whatsappCloudService.sendWhatsAppText(candidate.phone, confirmMsg);
      appendChatHistory(candidate, 'assistant', confirmMsg);
      console.log(`✅ Interview Confirmation sent to candidate ${candidate.name} (+${candidate.phone}) for ${formattedTime} (Rescheduled: ${isRescheduled})`);
      
      // Also Notify HR Phone(s)
      const hrPhones = (process.env.HR_PHONE_NUMBER || process.env.HR_PHONE_NUMBERS || '919329232025').split(',').map(p => p.trim()).filter(Boolean);
      for (const hrPhone of hrPhones) {
        if (hrPhone && cleanPhone(hrPhone) !== cleanPhone(candidate.phone)) {
          try {
            const hrMsg = `📢 *HR ALERT: ${isRescheduled ? 'Interview Rescheduled' : 'New Interview Scheduled'}* 📅\n\n👤 *Candidate:* ${candidate.name}\n📞 *Phone:* +${candidate.phone}\n💼 *Role:* ${candidate.role}\n🕒 *${isRescheduled ? 'New ' : ''}Date & Time:* ${formattedTime}\n📄 *Resume:* ${candidate.resumeReceived ? 'Received (Available)' : 'Pending'}\n🔗 *Portfolio:* ${candidate.portfolio || 'N/A'}\n📝 *Notes:* ${candidate.notes || 'In-Office Interview'}`;
            await whatsappCloudService.sendWhatsAppText(hrPhone, hrMsg);
            console.log(`📢 HR Alert sent to +${hrPhone} for scheduled candidate ${candidate.name}`);
          } catch (hrErr) {
            console.error(`Error sending HR scheduling alert to +${hrPhone}:`, hrErr.message);
          }
        }
      }

      if (ioInstance) {
        ioInstance.emit('log', {
          type: 'success',
          text: `📅 Interview Confirmation sent to ${candidate.name} (+${candidate.phone}) for ${formattedTime}`
        });
      }
    } catch (err) {
      console.error(`Error sending interview confirmation to +${candidate.phone}:`, err.message);
    }
  }

  return candidate;
}

/**
 * Send Missing Resume Reminder Manually or via Scheduler (English)
 */
async function sendResumeReminder(candidateId) {
  const candidate = candidates.find(c => c.id === candidateId || c.phone === cleanPhone(candidateId));
  if (!candidate) throw new Error('Candidate not found');

  const reminderText = `Hello ${candidate.name}! 👋\n\nThank you for your interest in joining *BrandSetu Digital* for the *${candidate.role || 'Job'}* position. We noticed we haven't received your updated *Resume / Portfolio* yet. 📄\n\n👉 Please share your Resume (PDF) or Portfolio link here so we can proceed with scheduling your interview. 🚀\n\n- HR Team, BrandSetu Digital (+91 9329232025)`;

  await whatsappCloudService.sendWhatsAppText(candidate.phone, reminderText);
  appendChatHistory(candidate, 'assistant', reminderText);
  candidate.resumeReminderSent = true;
  candidate.resumeReminderSentAt = new Date().toISOString();
  candidate.status = candidate.status === 'Applied' ? 'Resume Pending' : candidate.status;
  
  saveCandidatesAndSyncExcel();

  if (ioInstance) {
    ioInstance.emit('log', {
      type: 'info',
      text: `⏰ Missing Resume Reminder sent to ${candidate.name} (+${candidate.phone})`
    });
  }

  return candidate;
}

/**
 * Send Interview 1-Hour Reminder to Candidate AND HR
 */
async function sendInterview1HrReminder(candidate) {
  try {
    const interviewDate = new Date(candidate.interviewDateTime);
    const formattedTime = interviewDate.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    // 1. Send Reminder to Candidate (in English)
    const candidateReminderMsg = `Hello ${candidate.name}! 🔔 *Interview Reminder*\n\nThis is a quick reminder that your interview for the *${candidate.role}* position is scheduled today at *${formattedTime}* at the BrandSetu Digital office.\n\n📍 *Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Indore (M.P.) - 452014\n\nPlease arrive on time. For location assistance, call/WhatsApp: +91 9329232025. 👍\n\nSee you soon!\n- HR Team, BrandSetu Digital`;

    await whatsappCloudService.sendWhatsAppText(candidate.phone, candidateReminderMsg);
    appendChatHistory(candidate, 'assistant', candidateReminderMsg);
    console.log(`🔔 1-Hour Interview Reminder sent to candidate ${candidate.name} (+${candidate.phone})`);

    // 2. Send Alert Notification to HR (1 Hour Before)
    const hrPhone = process.env.HR_PHONE_NUMBER || '919329232025';
    try {
      const hrAlertMsg = `🔔 *HR ALERT: Interview in 1 Hour!* ⏰\n\nInterview scheduled today at *${formattedTime}*:\n\n👤 *Candidate:* ${candidate.name}\n📞 *Phone:* +${candidate.phone}\n💼 *Role:* ${candidate.role}\n🕒 *Interview Time:* ${formattedTime}\n📄 *Resume:* ${candidate.resumeReceived ? '✅ Received' : '⚠️ Pending'}\n🔗 *Portfolio/Work:* ${candidate.portfolio || 'N/A'}\n📝 *Notes:* ${candidate.notes || 'In-Office'}`;

      await whatsappCloudService.sendWhatsAppText(hrPhone, hrAlertMsg);
      console.log(`📢 1-Hour HR Alert dispatched to HR (+${hrPhone}) for candidate ${candidate.name}`);
    } catch (hrErr) {
      console.error(`Error sending 1-hr alert to HR (+${hrPhone}):`, hrErr.message);
    }

    candidate.interviewReminderSent = true;
    candidate.interviewReminderSentAt = new Date().toISOString();
    
    saveCandidatesAndSyncExcel();

    if (ioInstance) {
      ioInstance.emit('log', {
        type: 'success',
        text: `🔔 1-Hour Interview Alert sent to Candidate (+${candidate.phone}) & HR (+${hrPhone}) for ${formattedTime}`
      });
    }
  } catch (err) {
    console.error(`Error sending 1-hr reminder to +${candidate.phone}:`, err.message);
  }
}

/**
 * Background Automation Cron / Interval
 * Checks every 60 seconds:
 * 1. Missing Resume Reminders (4 hours after apply)
 * 2. 1-Hour Interview Reminders (Between 45 to 65 mins before interview)
 */
function runHiringAutomationCheck() {
  const now = new Date().getTime();
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000; // 4 Hours

  candidates.forEach(candidate => {
    // 1. Missing Resume Reminder (After 4 Hours if not received)
    if (!candidate.resumeReceived && !candidate.resumeReminderSent && candidate.createdAt) {
      const createdTime = new Date(candidate.createdAt).getTime();
      const elapsed = now - createdTime;
      if (elapsed >= FOUR_HOURS_MS) {
        console.log(`⏰ Triggering 4-hour missing resume reminder for +${candidate.phone}`);
        sendResumeReminder(candidate.id).catch(err => {
          console.error(`Failed sending resume reminder for +${candidate.phone}:`, err.message);
        });
      }
    }

    // 2. 1-Hour Before Interview Reminder
    if (candidate.status === 'Interview Scheduled' && candidate.interviewDateTime && !candidate.interviewReminderSent) {
      const interviewTime = new Date(candidate.interviewDateTime).getTime();
      const diffMs = interviewTime - now;
      const diffMinutes = Math.floor(diffMs / (60 * 1000));

      // If interview is within 45 to 65 minutes from now
      if (diffMinutes >= 0 && diffMinutes <= 65) {
        console.log(`🔔 Triggering 1-hour interview reminder for ${candidate.name} (+${candidate.phone}) in ${diffMinutes}m`);
        sendInterview1HrReminder(candidate).catch(err => {
          console.error(`Failed sending 1hr interview reminder for +${candidate.phone}:`, err.message);
        });
      }
    }
  });
}

/**
 * Check if the sender is an authorized HR / Admin phone number
 */
function isAuthorizedHr(senderPhone) {
  if (!senderPhone) return false;
  const cleanSender = cleanPhone(senderPhone);
  const rawHr = process.env.HR_PHONE_NUMBERS || process.env.HR_PHONE_NUMBER || '919329232025,917389824231';
  const hrList = rawHr.split(',').map(p => cleanPhone(p)).filter(Boolean);

  return hrList.some(hr => hr === cleanSender || cleanSender.endsWith(hr) || hr.endsWith(cleanSender));
}

/**
 * Handle HR WhatsApp Action Commands (Select, Reject, Hold, Status) sent from HR mobile phone
 */
async function handleHrWhatsAppCommand(senderPhone, messageText) {
  if (!messageText) return null;

  // Security Check: Only authorized HR numbers can execute admin actions!
  if (!isAuthorizedHr(senderPhone)) {
    return null; // Non-HR sender, let normal AI conversation handle it!
  }

  const raw = String(messageText).trim();

  // Pattern: "select 9876543210", "reject 9876543210", "hold 9876543210", "status 9876543210"
  const hrActionPattern = /^(select|selected|pass|hired|offer|reject|rejected|hold|pending|review|status)\s+([0-9\+\s\-]{8,15})/i;
  const match = raw.match(hrActionPattern);

  if (!match) return null;

  const action = match[1].toLowerCase();
  const rawTargetPhone = match[2];
  const targetClean = cleanPhone(rawTargetPhone);

  // Find candidate by phone number matching
  const candidate = candidates.find(c => {
    const cPhone = cleanPhone(c.phone);
    return cPhone === targetClean || cPhone.endsWith(targetClean) || targetClean.endsWith(cPhone);
  });

  if (!candidate) {
    return `⚠️ *Candidate Not Found!*\n\nPhone: +${targetClean} hamare CRM database me nahi mila. Kripya candidate ka 10-digit mobile number check karein.`;
  }

  const roleName = candidate.role || 'SEO Expert';
  const candName = candidate.name || 'Candidate';

  if (action === 'select' || action === 'selected' || action === 'pass' || action === 'hired' || action === 'offer') {
    candidate.status = 'Selected';
    candidate.updatedAt = new Date().toISOString();
    saveCandidatesAndSyncExcel();

    const candidateMsg = `Dear ${candName}! 🎉 *Congratulations!*\n\nWe are pleased to inform you that you have been *SELECTED* for the *${roleName}* position at *BrandSetu Digital* following your in-person interview! 👏✨\n\n📍 *Office Location:* 103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n📞 *HR Contact:* +91 9329232025\n\nOur HR team will connect with you shortly regarding the formal Offer Letter, documentation, and joining details. 📄💼\n\nWelcome to the BrandSetu Digital family! 🚀\n- HR Team, BrandSetu Digital`;

    try {
      await whatsappCloudService.sendWhatsAppText(candidate.phone, candidateMsg);
      appendChatHistory(candidate, 'assistant', candidateMsg);
    } catch (err) {
      console.error('Error sending WhatsApp selection message:', err.message);
    }

    return `✅ *Action Successful!*\n\nCandidate *${candName}* (+${candidate.phone}) ko *Selected* mark kar diya gaya hai aur unke WhatsApp par official Congratulations & Selection message send kar diya gaya hai! 🎉`;
  }

  if (action === 'reject' || action === 'rejected') {
    candidate.status = 'Rejected';
    candidate.updatedAt = new Date().toISOString();
    saveCandidatesAndSyncExcel();

    const candidateMsg = `Dear ${candName},\n\nThank you for taking the time to visit our Indore office and interview for the *${roleName}* position at *BrandSetu Digital*. 🙏\n\nWhile we appreciate your skills and time, we have decided to move forward with other candidates whose experience more closely matches our immediate requirements at this time.\n\nWe will keep your profile in our talent pool for relevant future openings. We wish you all the best in your career ahead! 🌟\n\nBest regards,\n- HR Team, BrandSetu Digital`;

    try {
      await whatsappCloudService.sendWhatsAppText(candidate.phone, candidateMsg);
      appendChatHistory(candidate, 'assistant', candidateMsg);
    } catch (err) {
      console.error('Error sending WhatsApp rejection message:', err.message);
    }

    return `✅ *Action Successful!*\n\nCandidate *${candName}* (+${candidate.phone}) ko *Rejected* mark kar diya gaya hai aur unke WhatsApp par polite feedback message send kar diya gaya hai. 👍`;
  }

  if (action === 'hold' || action === 'pending' || action === 'review') {
    candidate.status = 'On Hold';
    candidate.updatedAt = new Date().toISOString();
    saveCandidatesAndSyncExcel();

    const candidateMsg = `Dear ${candName},\n\nThank you for attending the in-person interview for the *${roleName}* position at *BrandSetu Digital*. 🙏\n\nYour profile is currently *Under Evaluation / On Hold* as our hiring committee completes all scheduled candidate rounds.\n\nWe will update you with the final decision within 2-3 business days. 👍\n\nBest regards,\n- HR Team, BrandSetu Digital`;

    try {
      await whatsappCloudService.sendWhatsAppText(candidate.phone, candidateMsg);
      appendChatHistory(candidate, 'assistant', candidateMsg);
    } catch (err) {
      console.error('Error sending WhatsApp on-hold message:', err.message);
    }

    return `✅ *Action Successful!*\n\nCandidate *${candName}* (+${candidate.phone}) ko *On Hold* mark kar diya gaya hai aur unke WhatsApp par update message bhej diya gaya hai. ⏳`;
  }

  if (action === 'status') {
    return `📋 *Candidate Status Info:*\n\n👤 *Name:* ${candName}\n📞 *Phone:* +${candidate.phone}\n💼 *Role:* ${roleName}\n📊 *Status:* ${candidate.status}\n📅 *Interview:* ${candidate.interviewDateTime || 'Not Scheduled'}\n📄 *Resume:* ${candidate.resumeReceived ? 'Received' : 'Pending'}\n🔗 *Portfolio:* ${candidate.portfolio || 'N/A'}`;
  }

  return null;
}

module.exports = {
  setHiringIo,
  loadCandidates,
  getCandidates: () => candidates,
  getHiringStats,
  saveCandidatesAndSyncExcel,
  trackCandidateFromMessage,
  appendChatHistory,
  scheduleInterview,
  sendResumeReminder,
  sendInterview1HrReminder,
  getCandidateDisplayName,
  handleHrWhatsAppCommand,
  CANDIDATES_EXCEL_FILE
};
