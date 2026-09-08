const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const whatsappCloudService = require('./whatsappCloud.service');

// Persistent storage directory (supports Render/Railway disks via DATA_DIR)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..');
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Error creating DATA_DIR:', e.message);
  }
}

const CANDIDATES_JSON_FILE = path.join(DATA_DIR, 'candidates_data.json');
const CANDIDATES_BACKUP_FILE = path.join(DATA_DIR, 'candidates_data.backup.json');
const CANDIDATES_EXCEL_FILE = path.join(DATA_DIR, 'candidates_hiring.xlsx');
const DELETED_PHONES_FILE = path.join(DATA_DIR, 'deleted_candidates.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

if (!fs.existsSync(BACKUPS_DIR)) {
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  } catch (e) {}
}

let candidates = [];
let ioInstance = null;
let lastSnapshotHour = '';
let mongoClient = null;
let mongoDb = null;
let candidatesCollection = null;

function setHiringIo(io) {
  ioInstance = io;
}

/**
 * Initialize MongoDB Atlas connection for real-time cloud synchronization
 */
async function initMongoDb() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri || !uri.startsWith('mongodb')) return;

  try {
    const { MongoClient } = require('mongodb');
    const dbName = process.env.MONGODB_DB || 'Aotumation';
    const colName = process.env.MONGODB_COLLECTION || 'Brandsetu Digital';

    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    candidatesCollection = mongoDb.collection(colName);
    console.log(`🍃 [MongoDB Atlas] Connected successfully to "${dbName}" -> "${colName}"!`);

    // Fetch and merge cloud candidates
    const cloudDocs = await candidatesCollection.find({}).toArray();
    if (cloudDocs.length > 0) {
      const cloudCandidates = cloudDocs.map(c => {
        const { _id, ...rest } = c;
        return { ...rest, id: rest.id || String(_id) };
      });
      candidates = mergeCandidates(candidates, cloudCandidates);
      console.log(`🍃 [MongoDB Atlas] Synchronized ${cloudDocs.length} candidates from cloud database!`);
      saveCandidatesAndSyncExcel(false);
      if (ioInstance) {
        ioInstance.emit('hiring:update', {
          candidates: candidates,
          stats: getHiringStats()
        });
      }
    } else if (candidates.length > 0) {
      console.log(`🍃 [MongoDB Atlas] Seeding ${candidates.length} candidates into cloud collection...`);
      for (const c of candidates) {
        await candidatesCollection.updateOne({ phone: c.phone }, { $set: { ...c, _id: c.id } }, { upsert: true });
      }
    }
  } catch (err) {
    console.warn('⚠️ [MongoDB Atlas] Connection notice (falling back to local files):', err.message);
  }
}

/**
 * Get list of permanently deleted candidate phone numbers
 */
function getDeletedPhones() {
  try {
    if (fs.existsSync(DELETED_PHONES_FILE)) {
      const content = fs.readFileSync(DELETED_PHONES_FILE, 'utf8');
      const list = JSON.parse(content);
      if (Array.isArray(list)) {
        return list.map(p => cleanPhone(p)).filter(Boolean);
      }
    }
  } catch (e) {
    console.error('Error reading deleted_candidates.json:', e.message);
  }
  return [];
}

/**
 * Record a candidate phone as permanently deleted
 */
function saveDeletedPhone(phone) {
  try {
    const cleaned = cleanPhone(phone);
    if (!cleaned) return;
    const list = getDeletedPhones();
    if (!list.includes(cleaned)) {
      list.push(cleaned);
      fs.writeFileSync(DELETED_PHONES_FILE, JSON.stringify(list, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('Error saving deleted phone:', e.message);
  }
}

/**
 * Remove a phone from deleted list (if re-allowing candidate)
 */
function removeDeletedPhone(phone) {
  try {
    const cleaned = cleanPhone(phone);
    if (!cleaned) return;
    let list = getDeletedPhones();
    list = list.filter(p => p !== cleaned);
    fs.writeFileSync(DELETED_PHONES_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Error removing deleted phone:', e.message);
  }
}

/**
 * Safely merge two candidate lists by phone, preserving chat history and latest statuses
 */
function mergeCandidates(primary, secondary) {
  const map = new Map();
  const deletedPhones = new Set(getDeletedPhones());

  const addOrMerge = (c) => {
    if (!c) return;
    const phoneKey = c.phone ? cleanPhone(c.phone) : (c.id || Math.random().toString());
    if (deletedPhones.has(phoneKey)) return;

    // Filter spam/garbage names
    const name = (c.name || '').trim().toLowerCase();
    if (name === 'candidate' || name === 'customer' || name === '') return;
    if (name.includes('dainik bhaskar') || name.includes('news') || name.includes('bct consulting') || name.includes('web developer')) return;
    if (['ritz', 'bhumi', 'abhi', 'sunshine ✨', 'manuuu😎', 'ultramodern technologies pvt ltd', 'rounak jain', 'rahul indore', 'priyanshu', 'viney dubey hr'].includes(name)) return;

    if (!map.has(phoneKey)) {
      map.set(phoneKey, {
        ...c,
        unreadCount: c.unreadCount || 0,
        chatHistory: Array.isArray(c.chatHistory) ? [...c.chatHistory] : []
      });
    } else {
      const existing = map.get(phoneKey);
      const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      const newTime = new Date(c.updatedAt || c.createdAt || 0).getTime();

      // Merge chat messages without duplicate duplicates
      const chatMap = new Map();
      const addMsg = (m) => {
        if (!m || !m.text) return;
        const ts = m.timestamp ? new Date(m.timestamp).toISOString().substring(0, 16) : '';
        const msgKey = `${m.role || 'user'}_${ts}_${(m.text || '').trim()}`;
        if (!chatMap.has(msgKey)) {
          chatMap.set(msgKey, m);
        }
      };

      (existing.chatHistory || []).forEach(addMsg);
      (c.chatHistory || []).forEach(addMsg);

      const mergedChat = Array.from(chatMap.values()).sort((m1, m2) => {
        return new Date(m1.timestamp || 0).getTime() - new Date(m2.timestamp || 0).getTime();
      });

      const base = newTime >= existingTime ? c : existing;
      const fallback = newTime >= existingTime ? existing : c;

      map.set(phoneKey, {
        ...base,
        name: (base.name && base.name !== 'Candidate' ? base.name : fallback.name) || 'Candidate',
        role: (base.role && base.role !== 'General Applicant' ? base.role : fallback.role) || 'General Applicant',
        experience: base.experience || fallback.experience || '',
        portfolio: base.portfolio || fallback.portfolio || '',
        resumeReceived: Boolean(base.resumeReceived || fallback.resumeReceived),
        resumeFileName: base.resumeFileName || fallback.resumeFileName || '',
        interviewDateTime: base.interviewDateTime || fallback.interviewDateTime || null,
        status: (base.status && base.status !== 'Applied' ? base.status : fallback.status) || 'Applied',
        unreadCount: Math.max(existing.unreadCount || 0, c.unreadCount || 0),
        chatHistory: mergedChat.slice(-100),
        lastMessage: mergedChat.length > 0 ? mergedChat[mergedChat.length - 1].text : (base.lastMessage || fallback.lastMessage || '')
      });
    }
  };

  (primary || []).forEach(addOrMerge);
  (secondary || []).forEach(addOrMerge);

  return Array.from(map.values());
}

/**
 * Load candidates with smart merge across primary JSON, backup mirror, and snapshot archives
 */
function loadCandidates() {
  let primaryList = [];
  let backupList = [];

  // 1. Read Primary File
  if (fs.existsSync(CANDIDATES_JSON_FILE)) {
    try {
      const data = fs.readFileSync(CANDIDATES_JSON_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) primaryList = parsed;
    } catch (err) {
      console.error('Error reading primary candidates_data.json:', err.message);
    }
  }

  // 2. Read Mirror Backup File
  if (fs.existsSync(CANDIDATES_BACKUP_FILE)) {
    try {
      const bData = fs.readFileSync(CANDIDATES_BACKUP_FILE, 'utf8');
      const bParsed = JSON.parse(bData);
      if (Array.isArray(bParsed)) backupList = bParsed;
    } catch (bErr) {
      console.error('Error reading backup candidates file:', bErr.message);
    }
  }

  // 3. If primary was wiped or missing, recover from latest snapshot in backups/
  if (primaryList.length === 0 && fs.existsSync(BACKUPS_DIR)) {
    try {
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length > 0) {
        const latestSnapshot = path.join(BACKUPS_DIR, files[0]);
        const sData = fs.readFileSync(latestSnapshot, 'utf8');
        const sParsed = JSON.parse(sData);
        if (Array.isArray(sParsed)) {
          backupList = [...backupList, ...sParsed];
          console.log(`📦 Restored candidates from backup snapshot: ${files[0]} (${sParsed.length} records)`);
        }
      }
    } catch (e) {}
  }

  // 4. Merge candidates safely (preventing data loss on server redeploys)
  candidates = mergeCandidates(primaryList, backupList);

  candidates.forEach(candidate => {
    if (candidate.unreadCount === undefined) {
      candidate.unreadCount = 0;
    }
  });

  console.log(`📋 Candidates Loaded: ${candidates.length} active candidates in pipeline.`);

  // Auto-sync back to primary and mirror backup if we recovered data
  if (candidates.length > 0 && (!fs.existsSync(CANDIDATES_JSON_FILE) || primaryList.length === 0)) {
    saveCandidatesAndSyncExcel();
  }
}

/**
 * Save candidates to JSON, Mirror Backup, Hourly Snapshot, and Excel file
 */
function saveCandidatesAndSyncExcel(syncToMongo = true) {
  try {
    const jsonStr = JSON.stringify(candidates, null, 2);

    // 1. Save Primary JSON
    fs.writeFileSync(CANDIDATES_JSON_FILE, jsonStr, 'utf8');

    // 2. Save Redundant Mirror Backup
    fs.writeFileSync(CANDIDATES_BACKUP_FILE, jsonStr, 'utf8');

    // 3. Hourly Snapshot in backups/ (keeps last 10 snapshots)
    try {
      const currentHour = new Date().toISOString().substring(0, 13);
      if (currentHour !== lastSnapshotHour) {
        lastSnapshotHour = currentHour;
        const snapshotFile = path.join(BACKUPS_DIR, `candidates_${currentHour.replace(/[^0-9]/g, '_')}.json`);
        fs.writeFileSync(snapshotFile, jsonStr, 'utf8');

        const allSnapshots = fs.readdirSync(BACKUPS_DIR)
          .filter(f => f.startsWith('candidates_') && f.endsWith('.json'))
          .sort();
        while (allSnapshots.length > 10) {
          const oldFile = path.join(BACKUPS_DIR, allSnapshots.shift());
          fs.unlinkSync(oldFile);
        }
      }
    } catch (snapErr) {}

    // 4. Background Sync to MongoDB Atlas (Cloud Permanent Storage)
    if (candidatesCollection && syncToMongo) {
      Promise.resolve().then(async () => {
        try {
          for (const c of candidates) {
            await candidatesCollection.updateOne(
              { phone: c.phone },
              { $set: { ...c, _id: c.id } },
              { upsert: true }
            );
          }
        } catch (mErr) {
          console.warn('⚠️ [MongoDB] Background sync notice:', mErr.message);
        }
      });
    }

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
        'Interview Mode': c.interviewMode === 'online' ? 'Online (Google Meet)' : 'In-Person (Indore Office)',
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
if (process.env.MONGODB_URI || process.env.MONGO_URL) {
  initMongoDb().catch(err => {
    console.warn('⚠️ [MongoDB Atlas] Startup connection error:', err.message);
  });
}

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

  if (role === 'user') {
    candidate.unreadCount = (Number(candidate.unreadCount) || 0) + 1;
  }

  // Keep last 100 messages for full context
  if (candidate.chatHistory.length > 100) {
    candidate.chatHistory = candidate.chatHistory.slice(-100);
  }
}

/**
 * Sanitize candidate name by stripping emojis, symbols, and non-name strings
 */
function cleanCandidateName(rawName) {
  if (!rawName) return 'Candidate';
  let cleaned = String(rawName).replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '');
  cleaned = cleaned.replace(/[^a-zA-Z\s\u0900-\u097F]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!cleaned || cleaned.length < 2) return 'Candidate';

  const blacklistedWords = new Set([
    'candidate', 'customer', 'user', 'allhumdullillha', 'alhamdulillah', 'allah',
    'sunshine', 'admin', 'brandsetu', 'brandsetudigital', 'snacks', 'house of snacks',
    'status', 'broadcast', 'unknown', 'null', 'undefined',
    'looking', 'apply', 'applying', 'interested', 'searching', 'seeking', 'fresher',
    'student', 'intern', 'internship', 'developer', 'designer', 'editor', 'writer',
    'working', 'coming', 'waiting', 'available', 'ready', 'living', 'graduate',
    'doing', 'learning', 'here', 'from', 'sir', 'maam', 'madam', 'mam', 'bro',
    'brother', 'regarding', 'about', 'please', 'kripya', 'namaste', 'hello', 'good',
    'morning', 'evening', 'digital', 'marketing', 'manager', 'video', 'expert',
    'graphic', 'seo', 'aeo', 'smm', 'profile', 'resume', 'cv', 'portfolio', 'link',
    'drive', 'call', 'message', 'help', 'enquiry', 'query', 'opportunity', 'vacancy',
    'openings', 'job', 'jobs', 'hours', 'time', 'day', 'office', 'indore', 'company',
    'hiring', 'want', 'need', 'yes', 'no', 'haan', 'nahi', 'karo', 'karna', 'krna',
    'chahiye', 'batao', 'bhejo', 'send', 'share', 'contact', 'number', 'phone'
  ]);

  const lowerWords = cleaned.toLowerCase().split(' ').filter(Boolean);
  if (lowerWords.length === 0) return 'Candidate';

  if (lowerWords.every(w => blacklistedWords.has(w)) || lowerWords.some(w => ['looking', 'applying', 'interested', 'fresher', 'intern', 'student', 'candidate', 'customer'].includes(w))) {
    return 'Candidate';
  }

  const validWords = lowerWords.filter(w => !blacklistedWords.has(w) && w.length >= 2);
  if (validWords.length === 0) return 'Candidate';

  return validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/**
 * Extract human name from resume filename e.g. "Bhoomika_Sankhla_Resume.PNG" -> "Bhoomika Sankhla"
 */
function extractNameFromResumeFilename(filename) {
  if (!filename) return null;
  let base = path.basename(filename);
  base = base.replace(/\.[a-zA-Z0-9]+$/, '');
  base = base.replace(/[\(_\-]?\d+[\)\_\-]?/g, ' ');
  base = base.replace(/\b(?:resume|cv|biodata|bio\s*data|curriculum|vitae|updated|update|new|final|latest|profile|document|doc|pdf|png|jpg|jpeg|draft|brandsetu)\b/gi, ' ');
  base = base.replace(/[\._\-]/g, ' ');
  base = base.replace(/([a-z])([A-Z])/g, '$1 $2');
  base = base.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!base || base.length < 3) return null;
  const words = base.split(' ').filter(w => w.length >= 2);
  if (words.length >= 1 && words.length <= 3) {
    const candidateName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const cleaned = cleanCandidateName(candidateName);
    if (cleaned !== 'Candidate') {
      return cleaned;
    }
  }
  return null;
}

/**
 * Check if URL belongs to a valid portfolio or creative hosting service
 */
function isValidPortfolioUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  const validDomains = [
    'drive.google.com',
    'docs.google.com',
    'behance.net',
    'figma.com',
    'dribbble.com',
    'github.com',
    'youtube.com',
    'youtu.be',
    'vimeo.com',
    'notion.site',
    'notion.so',
    'carrd.co',
    'artstation.com',
    'adobe.com',
    'canva.com',
    'dropbox.com',
    'onedrive.live.com',
    'linkedin.com/in/'
  ];
  return validDomains.some(d => lower.includes(d));
}

/**
 * Detect forwarded recruitment/interview notices from other companies (e.g. IIFL Securities, other HRs)
 */
function isThirdPartyRecruitmentForward(text) {
  if (!text) return false;
  const lower = text.toLowerCase();

  const thirdPartySignatures = [
    /greetings\s+from\s+(?!brand\s*setu)/i,
    /best\s+regards\s+hr\s+(?!brand\s*setu)/i,
    /regards\s*[:,-]?\s*hr\s+(?!brand\s*setu)/i,
    /team\s+hr\s+(?!brand\s*setu)/i,
    /interview\s+time\s*[-:]\s*\d/i,
    /interview\s+schedule\s*[-:]/i,
    /corporate\s+house/i,
    /securities\s+pvt\s+ltd/i,
    /here(?:'?s|\s+is)\s+the\s+interview\s+schedule/i,
    /as\s+we\s+discussed,?\s*here/i,
    /confirm\s+your\s+availability\s+for\s+the\s+scheduled\s+time/i
  ];

  return thirdPartySignatures.some(pattern => pattern.test(lower));
}

/**
 * Helper to get clean candidate first or display name
 */
function getCandidateDisplayName(candidate) {
  if (!candidate || !candidate.name) return '';
  const cleaned = cleanCandidateName(candidate.name);
  if (cleaned === 'Candidate') return '';
  return cleaned;
}

/**
 * Get proper candidate salutation (never "Dear Looking!" or "Dear Candidate!")
 */
function getCandidateSalutation(candidate, lang = 'english') {
  const name = getCandidateDisplayName(candidate);
  if (!name || name === 'Candidate' || name.toLowerCase() === 'looking') {
    return (lang === 'english' || lang === 'en') ? 'Hello!' : 'Namaste!';
  }
  return `Dear ${name}!`;
}

/**
 * Welcome & 6 Roles Response (Step 0 -> Step 1: Initial Ad click / Greeting / Inquiry)
 */
function getWelcomeRolesReply(lang = 'english') {
  const isHi = (lang === 'hinglish' || lang === 'hindi');
  if (isHi) {
    return `Brand Setu Digital me aapka swagat hai! 🎉\n\nHum Indore office ke liye in 6 active roles par hiring kar rahe hain:\n1️⃣ 🎬 *Video Editor*\n2️⃣ 🤖 *AI Video Expert*\n3️⃣ 🎨 *Graphic Designer*\n4️⃣ 🔎 *SEO & AEO Expert*\n5️⃣ 📱 *Social Media Manager*\n6️⃣ 📢 *Digital Marketing Manager*\n\n👉 Aap **kis position/role** ke liye apply karna chahte hain? (1 to 6 number ya role ka naam likhein) 📝`;
  }
  return `Welcome to Brand Setu Digital! 🎉\n\nWe are actively hiring for these 6 positions at our Indore office:\n1️⃣ 🎬 *Video Editor*\n2️⃣ 🤖 *AI Video Expert*\n3️⃣ 🎨 *Graphic Designer*\n4️⃣ 🔎 *SEO & AEO Expert*\n5️⃣ 📱 *Social Media Manager*\n6️⃣ 📢 *Digital Marketing Manager*\n\n👉 Which **position/role** would you like to apply for? (Please reply with number 1 to 6 or the role name) 📝`;
}

/**
 * Role Selected Response (Step 1 -> Step 2 transition)
 */
function getRoleSelectedReply(role, lang = 'english') {
  const isHi = (lang === 'hinglish' || lang === 'hindi');
  if (isHi) {
    return `Bahut badiya! Aapne *${role}* select kiya hai. 👍\n\nKripya batayein:\n1️⃣ Aap *Fresher (Paid Internship)* ke liye apply kar rahe hain ya *Experienced (Full-Time Role)* ke liye?\n2️⃣ Agar experienced hain, to aapko kitne time (months/years) ka experience hai? 💼`;
  }
  return `Great! You have selected *${role}*. 👍\n\nPlease let us know:\n1️⃣ Are you applying as a *Fresher (Paid Internship)* or *Experienced (Full-Time Role)*?\n2️⃣ If experienced, how many months/years of experience do you have? 💼`;
}

/**
 * Experience Answered Response (Step 2 -> Step 3 transition: Next Process is Resume & Portfolio)
 */
function getExperienceAnsweredReply(candidate, lang = 'english') {
  const isHi = (lang === 'hinglish' || lang === 'hindi');
  const role = (candidate && candidate.role && candidate.role !== 'General Applicant') ? candidate.role : 'Video Editor';

  if (role === 'AI Video Expert') {
    return isHi
      ? `Awesome! 🤖 Kripya apna updated *Resume (PDF)* aur AI video tools (Runway, Kling, Midjourney, etc.) ke samples ka *Google Drive link* yahan share karein. 📄🎥`
      : `Awesome! 🤖 Please share your updated *Resume (PDF)* and your AI video work samples / Google Drive link here. 📄🎥`;
  } else if (role === 'Graphic Designer') {
    return isHi
      ? `Perfect! 🎨 Kripya apna updated *Resume (PDF)* aur *Design Portfolio link (Behance / Drive / Figma)* yahan share karein. 📄🎨`
      : `Perfect! 🎨 Please share your updated *Resume (PDF)* and your *Design Portfolio (Behance / Drive / Figma link)* here. 📄🎨`;
  } else if (role === 'SEO & AEO Expert') {
    return isHi
      ? `Great! 🔎 Kripya apna updated *Resume (PDF)* aur live SEO rankings / case studies details yahan share karein. 📄📊`
      : `Great! 🔎 Please share your updated *Resume (PDF)* and your live SEO rankings / case studies proof here. 📄📊`;
  } else if (role === 'Social Media Manager') {
    return isHi
      ? `Super! 📱 Kripya apna updated *Resume (PDF)* aur past managed social media profiles / growth proof share karein. 📄🚀`
      : `Super! 📱 Please share your updated *Resume (PDF)* and your past managed social media profiles / growth proof here. 📄🚀`;
  } else if (role === 'Digital Marketing Manager') {
    return isHi
      ? `Excellent! 📢 Kripya apna updated *Resume (PDF)* aur Ad campaign / ROAS case studies yahan share karein. 📄💼`
      : `Excellent! 📢 Please share your updated *Resume (PDF)* and your Ad campaign / ROAS case studies here. 📄💼`;
  } else {
    return isHi
      ? `Bahut badiya! 🎬 Kripya apna updated *Resume (PDF)* aur Video Editing ka *Portfolio / Google Drive link* yahan share karein taaki hum aapka in-person practical interview schedule kar sakein. 📄🎥`
      : `Great! 🎬 Please share your updated *Resume (PDF)* and your Video Portfolio / Google Drive link here so we can schedule your interview. 📄🎥`;
  }
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

  let candidate = candidates.find(c => {
    if (messageData.chatId && c.whatsappChatId && c.whatsappChatId === messageData.chatId) {
      return true;
    }
    if (c.phone && cleanPhone(c.phone) === phone) {
      return true;
    }
    return false;
  });
  const nowIso = new Date().toISOString();

  // Extract drive / portfolio / doc link if present
  let extractedLink = '';
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/gi);
  if (urlMatch && urlMatch.length > 0) {
    for (const u of urlMatch) {
      if (isValidPortfolioUrl(u)) {
        extractedLink = u;
        break;
      }
    }
  }

  // Check if message is a third party recruitment invite
  const isForward = isThirdPartyRecruitmentForward(text);

  const hasValidDocumentUpload = !isForward && (msgType === 'document' || (
    (messageData.mediaFilename && messageData.mediaFilename.toLowerCase().endsWith('.pdf')) ||
    (text && text.toLowerCase().endsWith('.pdf'))
  ));

  const hasPortfolioLink = !isForward && (
    (extractedLink && isValidPortfolioUrl(extractedLink)) ||
    lower.includes('drive.google.com') ||
    lower.includes('docs.google.com') ||
    lower.includes('behance.net') ||
    lower.includes('figma.com') ||
    lower.includes('dribbble.com') ||
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.includes('github.com') ||
    lower.includes('notion.site') ||
    lower.includes('dropbox.com')
  );

  const hasResumeSignal = hasValidDocumentUpload || hasPortfolioLink;

  // Check if candidate is currently awaiting Step 2 (Experience / Fresher qualification)
  const isAwaitingExperience = candidate && candidate.role && candidate.role !== 'General Applicant' && (!candidate.experience || candidate.experience === '');

  const cleanTrimmed = lower.replace(/[^\w\s]/g, '').trim();
  let detectedRole = null;
  let detectedExperience = null;

  const expMatch = text.match(/(\d+(?:\.\d+)?\s*(?:year|yr|saal|month|mahine|yrs|mths)\b(?:[^\n,]*experience)?)/i) ||
                   text.match(/(?:experience|exp|experience:)\s*(\d+(?:\.\d+)?(?:\s*(?:year|yr|saal|month|mahine|yrs|mths))?)/i) ||
                   text.match(/^\s*(\d+(?:\.\d+)?)\s*$/m);

  const isFresherOrIntern = lower.includes('fresher') || lower.includes('freshor') || lower.includes('internship') || lower.includes('intern') || lower.includes('no experience') || lower.includes('learning');
  const isFullTimeOrExp = lower.includes('full time') || lower.includes('full-time') || lower.includes('fulltime') || lower.includes('experienced') || lower.includes('experience');

  if (isAwaitingExperience) {
    // In Step 2, "1" means Fresher (Option 1️⃣), "2" means Experienced (Option 2️⃣)
    if (cleanTrimmed === '1' || isFresherOrIntern) {
      detectedExperience = 'Fresher (Paid Internship)';
    } else if (cleanTrimmed === '2' || isFullTimeOrExp || expMatch) {
      const rawExp = expMatch ? (expMatch[1] || expMatch[0]) : null;
      const formattedExp = rawExp ? ((rawExp.includes('year') || rawExp.includes('month') || rawExp.includes('yr')) ? rawExp : `${rawExp} years`) : null;
      detectedExperience = formattedExp ? (isFullTimeOrExp ? `Full-Time (${formattedExp})` : formattedExp) : 'Experienced (Full-Time)';
    }
  } else {
    // In Step 1, "1" to "6" or role keywords select the active opening
    if (cleanTrimmed === '1' || cleanTrimmed.startsWith('1 ') || lower.includes('video editor') || lower.includes('video editing') || lower.includes('reels edit') || lower.includes('premiere') || lower.includes('after effects') || lower.includes('davinci')) {
      detectedRole = 'Video Editor';
    } else if (cleanTrimmed === '2' || cleanTrimmed.startsWith('2 ') || lower.includes('ai video') || lower.includes('ai reels') || lower.includes('runway') || lower.includes('kling') || lower.includes('midjourney') || lower.includes('pika') || lower.includes('heygen')) {
      detectedRole = 'AI Video Expert';
    } else if (cleanTrimmed === '3' || cleanTrimmed.startsWith('3 ') || lower.includes('graphic') || lower.includes('designer') || lower.includes('designing') || lower.includes('photoshop') || lower.includes('illustrator') || lower.includes('figma') || lower.includes('canva')) {
      detectedRole = 'Graphic Designer';
    } else if (cleanTrimmed === '4' || cleanTrimmed.startsWith('4 ') || lower.includes('seo') || lower.includes('aeo') || lower.includes('search engine') || lower.includes('ranking') || lower.includes('backlink')) {
      detectedRole = 'SEO & AEO Expert';
    } else if (cleanTrimmed === '5' || cleanTrimmed.startsWith('5 ') || lower.includes('social media') || lower.includes('smm') || lower.includes('instagram manager') || lower.includes('social manager')) {
      detectedRole = 'Social Media Manager';
    } else if (cleanTrimmed === '6' || cleanTrimmed.startsWith('6 ') || lower.includes('digital marketing') || lower.includes('performance marketing') || lower.includes('meta ads') || lower.includes('facebook ads') || lower.includes('google ads') || lower.includes('media buyer')) {
      detectedRole = 'Digital Marketing Manager';
    }

    // Only lock detectedExperience if explicitly stated together with role in this message
    if (detectedRole && (isFresherOrIntern || isFullTimeOrExp || expMatch)) {
      if (isFresherOrIntern) {
        detectedExperience = 'Fresher (Paid Internship)';
      } else if (expMatch) {
        const rawExp = expMatch[1] || expMatch[0];
        const formattedExp = (rawExp.includes('year') || rawExp.includes('month') || rawExp.includes('yr')) ? rawExp : `${rawExp} years`;
        detectedExperience = isFullTimeOrExp ? `Full-Time (${formattedExp})` : formattedExp;
      } else if (isFullTimeOrExp) {
        detectedExperience = 'Experienced (Full-Time)';
      }
    }
  }

  // Detect Candidate Name if sent in message or resume filename
  let extractedName = null;
  const nameFromFilename = extractNameFromResumeFilename(messageData.mediaFilename || (text.toLowerCase().endsWith('.pdf') || text.toLowerCase().endsWith('.png') || text.toLowerCase().endsWith('.jpg') ? text : ''));
  if (nameFromFilename) {
    extractedName = nameFromFilename;
  }

  if (!extractedName && !isForward) {
    const explicitNamePattern = /(?:my name is|mera naam\s*(?:hai)?|name\s*[:=-]|myself)\s+([A-Za-z\s]{2,30}?)(?:\r?\n|,\s*|\s+(?:hai|role|apply|for|mobile|phone|exp|city|$))/i;
    const explicitMatch = text.match(explicitNamePattern);
    if (explicitMatch && explicitMatch[1]) {
      const cleanN = cleanCandidateName(explicitMatch[1].trim());
      if (cleanN !== 'Candidate') {
        extractedName = cleanN;
      }
    }

    // Only allow "I am [Name]" if strictly capitalized proper noun and not a verb/adjective
    if (!extractedName) {
      const iAmMatch = text.match(/\b(?:i\s*am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
      if (iAmMatch && iAmMatch[1]) {
        const cleanN = cleanCandidateName(iAmMatch[1].trim());
        if (cleanN !== 'Candidate') {
          extractedName = cleanN;
        }
      }
    }
  }

  // Check if this is a fresh application intent (e.g. candidate clicks Instagram Ad, types "apply", "new apply", "restart", "start", or sends ad greeting)
  const isFreshApplyIntent = (
    lower === 'apply' ||
    lower === 'new apply' ||
    lower === 'restart' ||
    lower.startsWith('apply for') ||
    lower.includes('can i get more info') ||
    lower.includes('looking for job') ||
    lower.includes('hiring ke liye')
  );

  // Fallback to WhatsApp profile name if valid
  const rawCustomerName = (messageData.customerName || '').trim();
  const validProfileName = (rawCustomerName && rawCustomerName.toLowerCase() !== 'customer' && rawCustomerName.toLowerCase() !== 'user')
    ? rawCustomerName
    : null;

  const initialName = cleanCandidateName(extractedName || validProfileName);

  // Detect language of the incoming message
  const msgLang = detectCandidateLang(text);

  if (!candidate) {
    if (!text && !hasValidDocumentUpload) return null;
    candidate = {
      id: `cand_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      phone: phone,
      whatsappChatId: messageData.chatId || null,
      name: initialName,
      role: detectedRole || 'General Applicant',
      city: 'Indore',
      lang: msgLang,
      experience: detectedExperience || '',
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
      justSelectedRole: Boolean(detectedRole && !detectedExperience),
      justAnsweredExperience: Boolean(detectedRole && detectedExperience),
      chatHistory: []
    };
    appendChatHistory(candidate, 'user', text);
    candidates.unshift(candidate);
    console.log(`📋 New Candidate Registered: ${candidate.name} (+${candidate.phone}) for ${candidate.role} [Lang: ${candidate.lang}]`);
  } else {
    // Update existing candidate
    if (messageData.chatId) candidate.whatsappChatId = messageData.chatId;
    candidate.updatedAt = nowIso;
    candidate.lastMessage = text;
    if (text) candidate.lang = msgLang;
    appendChatHistory(candidate, 'user', text);

    if (extractedName && extractedName !== 'Candidate') {
      candidate.name = cleanCandidateName(extractedName);
    } else if (nameFromFilename && (candidate.name === 'Candidate' || candidate.name === 'Customer' || candidate.name.toLowerCase() === 'looking' || !candidate.name)) {
      candidate.name = nameFromFilename;
    } else if (validProfileName && (candidate.name === 'Candidate' || candidate.name === 'Customer' || candidate.name.toLowerCase() === 'looking' || !candidate.name)) {
      const cleanProfile = cleanCandidateName(validProfileName);
      if (cleanProfile !== 'Candidate') candidate.name = cleanProfile;
    }

    // Clean up if candidate currently has an invalid/blacklisted name
    if (candidate.name && cleanCandidateName(candidate.name) === 'Candidate') {
      candidate.name = 'Candidate';
    }

    // Reset temporary action flags
    candidate.justSelectedRole = false;
    candidate.justAnsweredExperience = false;

    // If candidate sends a fresh apply intent, reset stale interview/role state for the new flow
    if (isFreshApplyIntent) {
      console.log(`🔄 Candidate ${candidate.name} (+${candidate.phone}) restarted application flow`);
      candidate.role = detectedRole || 'General Applicant';
      candidate.experience = detectedExperience || '';
      candidate.justSelectedRole = Boolean(detectedRole && !detectedExperience);
      candidate.justAnsweredExperience = Boolean(detectedRole && detectedExperience);
      candidate.offTopicCount = 0;
      candidate.interviewDateTime = null;
      candidate.status = candidate.resumeReceived ? 'Resume Received' : 'Applied';
    } else if (detectedRole && (candidate.role === 'General Applicant' || candidate.role !== detectedRole)) {
      console.log(`🎯 Candidate ${candidate.name} (+${candidate.phone}) selected role: ${detectedRole}`);
      candidate.role = detectedRole;
      if (detectedExperience) {
        candidate.experience = detectedExperience;
        candidate.justAnsweredExperience = true;
      } else {
        candidate.experience = '';
        candidate.justSelectedRole = true;
      }
    } else if (isAwaitingExperience && detectedExperience) {
      console.log(`💼 Candidate ${candidate.name} (+${candidate.phone}) provided experience: ${detectedExperience}`);
      candidate.experience = detectedExperience;
      candidate.justAnsweredExperience = true;
    } else if (detectedExperience && (!candidate.experience || candidate.experience === '')) {
      candidate.experience = detectedExperience;
      candidate.justAnsweredExperience = true;
    }

    // If candidate had an old interview in the past, clear the expired interview date
    if (candidate.interviewDateTime && new Date(candidate.interviewDateTime).getTime() < (Date.now() - 24 * 3600 * 1000)) {
      candidate.interviewDateTime = null;
      if (candidate.status === 'Interview Scheduled') {
        candidate.status = candidate.resumeReceived ? 'Resume Received' : 'Applied';
      }
    }

    if (extractedLink) {
      candidate.portfolio = extractedLink;
    }

    if (hasResumeSignal && !candidate.resumeReceived) {
      candidate.resumeReceived = true;
      candidate.resumeReceivedAt = nowIso;
      candidate.interviewSlotProposed = false;
      candidate.resumeFileName = msgType === 'document' ? (messageData.messageText || 'Resume Document') : 'Portfolio Link';
      if (candidate.status === 'Applied' || candidate.status === 'Resume Pending') {
        candidate.status = 'Resume Received';
      }
      if (nameFromFilename && (candidate.name === 'Candidate' || candidate.name === 'Customer' || candidate.name.toLowerCase() === 'looking' || !candidate.name)) {
        candidate.name = nameFromFilename;
      }
      console.log(`📄 Resume / Portfolio Received from candidate: ${candidate.name} (+${candidate.phone})`);
    }

    // Move candidate with latest message to the top of the pipeline list
    const candIdx = candidates.findIndex(c => c.id === candidate.id);
    if (candIdx > 0) {
      candidates.splice(candIdx, 1);
      candidates.unshift(candidate);
    }
  }

  saveCandidatesAndSyncExcel();
  return candidate;
}

/**
 * Mark all incoming messages for a candidate as read.
 */
function markCandidateMessagesRead(candidateId) {
  const candidate = candidates.find(c => c.id === candidateId || c.phone === cleanPhone(candidateId));
  if (!candidate) {
    throw new Error('Candidate not found');
  }

  candidate.unreadCount = 0;
  candidate.updatedAt = new Date().toISOString();
  saveCandidatesAndSyncExcel();
  return candidate;
}

function detectCandidateLang(text) {
  if (!text) return 'hinglish';
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';
  const clean = text.toLowerCase().trim();
  const strongHinglishWords = [
    'kese', 'kaise', 'kaha', 'kahan', 'batao', 'bataye', 'batayein', 'hoga',
    'krte', 'karte', 'karna', 'chahiye', 'mera', 'meri', 'mere', 'aapse',
    'krna', 'bhi', 'kuchh', 'achha', 'accha', 'kitna', 'kitni', 'milega',
    'milegi', 'lagega', 'aa sakta hu', 'aa skta hu', 'dopahar', 'baje',
    'kya', 'hai', 'h', 'hum', 'aap', 'ji', 'theek', 'thik', 'bhejo', 'bheja',
    'aana', 'jana', 'kab', 'kis', 'parso', 'kal', 'nhi', 'nahi', 'mujhe',
    'bhai', 'sir', 'haan', 'sahi', 'dekh', 'raha', 'rahi', 'karein', 'karo'
  ];
  const words = clean.split(/[\s,?.!]+/);
  const countHinglish = words.filter(w => strongHinglishWords.includes(w)).length;
  if (countHinglish >= 1) {
    return 'hinglish';
  }
  return 'english';
}

/**
 * Schedule Interview Date/Time for a candidate
 */
async function scheduleInterview(candidateId, interviewDateTime, role, notes = '', sendInstantConfirmation = true, mode = 'in_person') {
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
  candidate.interviewMode = (mode === 'online' || candidate.interviewMode === 'online') ? 'online' : 'in_person';
  candidate.status = 'Interview Scheduled';
  candidate.interviewReminderSent = false; // Reset 1-hr reminder for new schedule
  candidate.interviewReminderSentAt = null;
  if (role && role !== 'General Applicant') candidate.role = role;
  if (notes) candidate.notes = notes;
  candidate.updatedAt = new Date().toISOString();

  saveCandidatesAndSyncExcel();

  const isOnline = candidate.interviewMode === 'online';
  const isEnglish = (candidate.lang === 'english');

  // Send Instant Confirmation Message to candidate (in strictly matched English or Hinglish)
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

      let confirmMsg = '';
      const salutationEn = getCandidateSalutation(candidate, 'english');
      const salutationHi = getCandidateSalutation(candidate, 'hinglish');

      if (isEnglish) {
        if (isOnline) {
          confirmMsg = isRescheduled
            ? `${salutationEn} 🔄\n\nYour *Online Google Meet Interview* for the *${candidate.role || 'Job'}* position at *BrandSetu Digital* has been *rescheduled successfully*. 💻✨\n\n📅 *Updated Date & Time:* ${formattedTime}\n🔗 *Platform:* Google Meet (Online)\n📌 *Important Note:* You will receive the Google Meet joining link here on WhatsApp 15 minutes before the interview starts.\n\nSee you then! 👍\n- HR Team, BrandSetu Digital (+91 9329232025)`
            : `${salutationEn} 🎉\n\nYour *Online Google Meet Interview* for the *${candidate.role || 'Job'}* position at *BrandSetu Digital* has been scheduled successfully. 💻✨\n\n📅 *Date & Time:* ${formattedTime}\n🔗 *Platform:* Google Meet (Online)\n📌 *Important Note:* You will receive the Google Meet joining link here on WhatsApp 15 minutes before the interview starts.\n\nBest of luck! 👍\n- HR Team, BrandSetu Digital (+91 9329232025)`;
        } else {
          confirmMsg = isRescheduled
            ? `${salutationEn} 🔄\n\nYour in-person interview for the *${candidate.role || 'Job'}* position at *BrandSetu Digital* has been *rescheduled successfully*.\n\n📅 *Updated Date & Time:* ${formattedTime}\n📍 *Office Address:* 103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n📌 Please bring your updated Resume and work samples/portfolio.\n\nFor any questions or directions, reply here or contact us at +91 9329232025.\n\nSee you then! 👍\n- HR Team, BrandSetu Digital`
            : `${salutationEn} 🎉\n\nYour in-person interview for the *${candidate.role || 'Job'}* position at *BrandSetu Digital* has been scheduled successfully.\n\n📅 *Date & Time:* ${formattedTime}\n📍 *Office Address:* 103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n📌 Please bring your updated Resume and work samples/portfolio.\n\nFor any questions or directions, reply here or contact us at +91 9329232025.\n\nBest of luck! 👍\n- HR Team, BrandSetu Digital`;
        }
      } else {
        // Hinglish
        if (isOnline) {
          confirmMsg = isRescheduled
            ? `${salutationHi} 🔄\n\nBrandSetu Digital me *${candidate.role || 'Job'}* position ke liye aapka *Online Google Meet Interview* *reschedule* ho gaya hai. 💻✨\n\n📅 *Updated Date & Time:* ${formattedTime}\n🔗 *Platform:* Google Meet (Online)\n📌 *Important Note:* Interview start hone se *15 minute pehle* aapko WhatsApp par Google Meet joining link send kar di jayegi.\n\nSee you then! 👍\n- HR Team, BrandSetu Digital (+91 9329232025)`
            : `${salutationHi} 🎉\n\nBrandSetu Digital me *${candidate.role || 'Job'}* position ke liye aapka *Online Google Meet Interview* schedule ho gaya hai. 💻✨\n\n📅 *Date & Time:* ${formattedTime}\n🔗 *Platform:* Google Meet (Online)\n📌 *Important Note:* Interview start hone se *15 minute pehle* aapko isi WhatsApp chat par Google Meet joining link send kar di jayegi.\n\nAll the best! 👍\n- HR Team, BrandSetu Digital (+91 9329232025)`;
        } else {
          confirmMsg = isRescheduled
            ? `${salutationHi} 🔄\n\nBrandSetu Digital me *${candidate.role || 'Job'}* position ke liye aapka in-person interview *reschedule* ho gaya hai.\n\n📅 *Updated Date & Time:* ${formattedTime}\n📍 *Office Address:* 103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n📌 Kripya apna updated Resume aur portfolio saath lekar aayein.\n\nKisi bhi jaankari ya location ke liye aap +91 9329232025 par call ya message kar sakte hain.\n\nSee you then! 👍\n- HR Team, BrandSetu Digital`
            : `${salutationHi} 🎉\n\nBrandSetu Digital me *${candidate.role || 'Job'}* position ke liye aapka in-person interview schedule ho gaya hai.\n\n📅 *Date & Time:* ${formattedTime}\n📍 *Office Address:* 103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n📌 Kripya apna updated Resume aur portfolio saath lekar aayein.\n\nKisi bhi jaankari ya location ke liye aap +91 9329232025 par call ya message kar sakte hain.\n\nAll the best! 👍\n- HR Team, BrandSetu Digital`;
        }
      }

      const candidateRecipient = candidate.whatsappChatId || candidate.phone;
      await whatsappCloudService.sendWhatsAppText(candidateRecipient, confirmMsg);
      appendChatHistory(candidate, 'assistant', confirmMsg);
      console.log(`✅ Interview Confirmation sent to candidate ${candidate.name} (+${candidate.phone}) for ${formattedTime} (Mode: ${candidate.interviewMode}, Lang: ${candidate.lang || 'hinglish'})`);
      
      // Also Notify HR Phone(s)
      const hrPhones = (process.env.HR_PHONE_NUMBER || process.env.HR_PHONE_NUMBERS || '919329232025').split(',').map(p => p.trim()).filter(Boolean);
      for (const hrPhone of hrPhones) {
        if (hrPhone && cleanPhone(hrPhone) !== cleanPhone(candidate.phone)) {
          try {
            const hrLocation = isOnline ? '💻 Online (Google Meet) - *15 min pehle candidate ko link share karein*' : '📍 103 Orange Business Park, Bhawarkua, Indore';
            const hrMsg = `📢 *HR ALERT: ${isRescheduled ? 'Interview Rescheduled' : 'Naya Interview Schedule Hua Hai!'}* 📅\n\n👤 *Candidate Name:* ${candidate.name}\n💼 *Role Applied:* ${candidate.role}\n📞 *Candidate Phone:* +${candidate.phone}\n🕒 *Scheduled Date & Time:* ${formattedTime}\n🌐 *Mode:* ${isOnline ? 'Online (Google Meet)' : 'In-Person (Indore Office)'}\n📍 *Location/Link:* ${hrLocation}\n📄 *Resume:* ${candidate.resumeReceived ? '✅ Received' : '⚠️ Pending'}\n🔗 *Portfolio:* ${candidate.portfolio || 'N/A'}\n\n👉 Kripya is time par interview setup ready rakhein. 👍`;
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
          text: `📅 Interview Confirmation sent to ${candidate.name} (+${candidate.phone}) for ${formattedTime} (${isOnline ? 'Google Meet' : 'In-Person'})`
        });
      }
    } catch (err) {
      console.error(`Error sending interview confirmation to +${candidate.phone}:`, err.message);
    }
  }

  return candidate;
}

/**
 * Send Missing Resume Reminder Manually or via Scheduler (Language matched)
 */
async function sendResumeReminder(candidateId) {
  const candidate = candidates.find(c => c.id === candidateId || c.phone === cleanPhone(candidateId));
  if (!candidate) throw new Error('Candidate not found');

  const isEnglish = (candidate.lang === 'english');
  const reminderText = isEnglish
    ? `Hello ${candidate.name || 'Candidate'}! 👋\n\nThank you for your interest in joining *BrandSetu Digital* for the *${candidate.role || 'Job'}* position. We noticed we haven't received your updated *Resume / Portfolio* yet. 📄\n\n👉 Please share your Resume (PDF) or Portfolio link here so we can proceed with scheduling your interview. 🚀\n\n- HR Team, BrandSetu Digital (+91 9329232025)`
    : `Namaste ${candidate.name || 'Candidate'}! 👋\n\nBrandSetu Digital me *${candidate.role || 'Job'}* position ke liye aapke interest ke liye dhanyawad. Humein abhi tak aapka updated *Resume / Portfolio* receive nahi hua hai. 📄\n\n👉 Kripya apna Resume (PDF) ya Portfolio link yahan share karein taaki hum aapka interview schedule kar sakein. 🚀\n\n- HR Team, BrandSetu Digital (+91 9329232025)`;

  const candidateRecipient = candidate.whatsappChatId || candidate.phone;

  // Mark reminder as attempted/sent immediately to prevent infinite cron loops on delivery failure
  candidate.resumeReminderSent = true;
  candidate.resumeReminderSentAt = new Date().toISOString();
  candidate.status = candidate.status === 'Applied' ? 'Resume Pending' : candidate.status;
  saveCandidatesAndSyncExcel();

  try {
    await whatsappCloudService.sendWhatsAppText(candidateRecipient, reminderText);
    appendChatHistory(candidate, 'assistant', reminderText);
    saveCandidatesAndSyncExcel();

    if (ioInstance) {
      ioInstance.emit('log', {
        type: 'info',
        text: `⏰ Missing Resume Reminder sent to ${candidate.name || 'Candidate'} (+${candidate.phone})`
      });
    }
  } catch (err) {
    console.error(`⚠️ Could not deliver resume reminder to ${candidate.name || 'Candidate'} (+${candidate.phone}):`, err.message);
    if (ioInstance) {
      ioInstance.emit('log', {
        type: 'warning',
        text: `⚠️ Resume Reminder delivery skipped for ${candidate.name || 'Candidate'} (+${candidate.phone}): ${err.message}`
      });
    }
    throw err;
  }

  return candidate;
}

/**
 * Send Interview 1-Hour Reminder to Candidate AND HR (Language matched)
 */
async function sendInterview1HrReminder(candidate) {
  // Mark reminder as attempted/sent immediately to prevent repeated cron loops on error
  candidate.interviewReminderSent = true;
  candidate.interviewReminderSentAt = new Date().toISOString();
  saveCandidatesAndSyncExcel();

  try {
    const isOnline = candidate.interviewMode === 'online';
    const isEnglish = (candidate.lang === 'english');
    const interviewDate = new Date(candidate.interviewDateTime);
    const formattedTime = interviewDate.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    // 1. Send Reminder to Candidate (Strictly matched English / Hinglish)
    let candidateReminderMsg = '';
    if (isEnglish) {
      candidateReminderMsg = isOnline
        ? `Hello ${candidate.name}! 🔔 *Interview Reminder*\n\nYour *Online Google Meet Interview* for *${candidate.role}* at *Brand Setu Digital* is scheduled today at *${formattedTime}*. 💻\n\n📌 *Joining Link:* You will receive the Google Meet link here on WhatsApp 15 minutes before the interview starts.\n\n👉 Are you ready and available for the interview? Please confirm. 👍\n\n📞 Help: +91 9329232025\n- HR Team, Brand Setu Digital`
        : `Hello ${candidate.name}! 🔔 *Interview Reminder*\n\nYour in-person interview for *${candidate.role}* at *Brand Setu Digital* is scheduled today at *${formattedTime}*.\n\n📍 *Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Indore (M.P.) - 452014\n\n👉 Are you on your way to our office for the interview? Please confirm. 👍\n\n📞 Help/Directions: +91 9329232025\n- HR Team, Brand Setu Digital`;
    } else {
      candidateReminderMsg = isOnline
        ? `Hello ${candidate.name}! 🔔 *Interview Reminder*\n\nAaj aapka *Brand Setu Digital* me *${candidate.role}* ke liye *Online Google Meet Interview* scheduled hai at *${formattedTime}*. 💻\n\n📌 *Joining Link:* Interview shuru hone se 15 minute pehle aapko isi WhatsApp chat par Google Meet link mil jayegi.\n\n👉 Kya aap interview ke liye ready aur available hain? Kripya confirm karein. 👍\n\n📞 Help: +91 9329232025\n- HR Team, Brand Setu Digital`
        : `Hello ${candidate.name}! 🔔 *Interview Reminder*\n\nAaj aapka *Brand Setu Digital* me *${candidate.role}* ke liye interview scheduled hai at *${formattedTime}*.\n\n📍 *Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Indore (M.P.) - 452014\n\n👉 Kya aap interview ke liye office aa rahe hain? Kripya confirm karein. 👍\n\n📞 Help/Directions: +91 9329232025\n- HR Team, Brand Setu Digital`;
    }

    const candidateRecipient = candidate.whatsappChatId || candidate.phone;
    try {
      await whatsappCloudService.sendWhatsAppText(candidateRecipient, candidateReminderMsg);
      appendChatHistory(candidate, 'assistant', candidateReminderMsg);
      console.log(`🔔 1-Hour Interview Reminder sent to candidate ${candidate.name} (+${candidate.phone}) (Lang: ${candidate.lang || 'hinglish'})`);
    } catch (candErr) {
      console.error(`Error sending 1-hr reminder to candidate (+${candidate.phone}):`, candErr.message);
    }

    // 2. Send Alert Notification to HR (1 Hour Before)
    const hrPhones = (process.env.HR_PHONE_NUMBER || process.env.HR_PHONE_NUMBERS || '919329232025').split(',').map(p => p.trim()).filter(Boolean);
    for (const hrPhone of hrPhones) {
      if (hrPhone && cleanPhone(hrPhone) !== cleanPhone(candidate.phone)) {
        try {
          const hrAlertMsg = isOnline
            ? `🔔 *HR ALERT: Online Google Meet Interview in 1 Hour!* ⏰\n\n👤 *Candidate:* ${candidate.name}\n📞 *Phone:* +${candidate.phone}\n💼 *Role:* ${candidate.role}\n🕒 *Interview Time:* ${formattedTime}\n💻 *Mode:* Online (Google Meet)\n\n👉 *Action Required:* Kripya interview se 15 minute pehle candidate ko Google Meet link share karein.`
            : `🔔 *HR ALERT: Candidate Interview in 1 Hour!* ⏰\n\n👤 *Candidate:* ${candidate.name}\n📞 *Phone:* +${candidate.phone}\n💼 *Role:* ${candidate.role}\n🕒 *Interview Time:* ${formattedTime}\n📍 *Location:* 103 Orange Business Park, Bhawarkua, Indore\n\n👉 Kripya interview assessment setup ready rakhein.`;
          await whatsappCloudService.sendWhatsAppText(hrPhone, hrAlertMsg);
          console.log(`📢 1-Hour HR Alert dispatched to HR (+${hrPhone}) for candidate ${candidate.name}`);
        } catch (hrErr) {
          console.error(`Error sending 1-hr alert to HR (+${hrPhone}):`, hrErr.message);
        }
      }
    }

    saveCandidatesAndSyncExcel();

    if (ioInstance) {
      ioInstance.emit('log', {
        type: 'success',
        text: `🔔 1-Hour Interview Alert sent for Candidate ${candidate.name} (+${candidate.phone}) for ${formattedTime}`
      });
    }
  } catch (err) {
    console.error(`Error processing 1-hr reminder for +${candidate.phone}:`, err.message);
  }
}

/**
 * Send In-Person Interview Slot Proposal (10-15 mins after resume review)
 */
async function sendInterviewSlotProposal(candidate) {
  if (!candidate || candidate.interviewDateTime || candidate.status === 'Not Interested' || candidate.interviewSlotProposed) {
    return;
  }

  candidate.interviewSlotProposed = true;
  candidate.interviewSlotProposedAt = new Date().toISOString();
  saveCandidatesAndSyncExcel();

  const isEnglish = (candidate.lang === 'english');
  const candName = getCandidateDisplayName(candidate);
  const greeting = candName && candName !== 'Candidate' ? `Hello ${candName}! 😊` : 'Hello! 😊';

  const proposalMsg = isEnglish
    ? `${greeting}\n\nGreat news! Your profile and portfolio have been shortlisted by our HR team. 👏✨\n\n👉 Are you available to visit our Indore office (*103 Orange Business Park, Bhawarkua*) for an in-person practical interview tomorrow morning between *10:00 AM and 12:00 PM*? 🏢\n\nPlease confirm (Yes / No or share your preferred time). 👍`
    : `${greeting}\n\nAapki profile aur portfolio HR team dwara shortlist kar li gayi hai. 👏✨\n\n👉 Kya aap kal morning me *10:00 AM se 12:00 PM* ke beech hamare Indore office (*103 Orange Business Park, Bhawarkua*) in-person interview ke liye aa sakte hain? 🏢\n\nKripya confirm karein (Haan / Nahi ya apna suitable time batayein). 👍`;

  const recipient = candidate.whatsappChatId || candidate.phone;
  try {
    await whatsappCloudService.sendWhatsAppText(recipient, proposalMsg);
    appendChatHistory(candidate, 'assistant', proposalMsg);
    saveCandidatesAndSyncExcel();

    console.log(`📅 10-15 Min Delayed Interview Slot Proposal dispatched to candidate ${candidate.name} (+${candidate.phone})`);
    if (ioInstance) {
      ioInstance.emit('log', {
        type: 'info',
        text: `📅 Interview Slot Proposal sent to ${candidate.name} (+${candidate.phone}) (after 10-15 min resume review)`
      });
    }
  } catch (err) {
    console.error(`Error sending interview slot proposal to +${candidate.phone}:`, err.message);
  }
}

/**
 * Background Automation Cron / Interval
 * Checks every 60 seconds:
 * 1. Missing Resume Reminders (4 hours after apply)
 * 2. 1-Hour Interview Reminders (Between 45 to 65 mins before interview)
 * 3. Delayed Interview Slot Proposal (10 to 15 mins after Resume Received)
 */
function runHiringAutomationCheck() {
  const now = new Date().getTime();
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000; // 4 Hours
  const TEN_MINS_MS = 10 * 60 * 1000; // 10 Minutes

  candidates.forEach(candidate => {
    // 1. Missing Resume Reminder (After 4 Hours if not received)
    if (!candidate.resumeReceived && !candidate.resumeReminderSent && candidate.createdAt) {
      const createdTime = new Date(candidate.createdAt).getTime();
      const elapsed = now - createdTime;
      if (elapsed >= FOUR_HOURS_MS) {
        console.log(`⏰ Triggering 4-hour missing resume reminder for ${candidate.name || 'Candidate'} (+${candidate.phone})`);
        sendResumeReminder(candidate.id).catch(err => {
          // Logged inside sendResumeReminder
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
          // Logged inside sendInterview1HrReminder
        });
      }
    }

    // 3. Delayed Interview Slot Proposal (10-15 mins after Resume Received)
    if (candidate.resumeReceived && !candidate.interviewSlotProposed && !candidate.interviewDateTime && candidate.status !== 'Not Interested') {
      const resumeTime = candidate.resumeReceivedAt ? new Date(candidate.resumeReceivedAt).getTime() : (candidate.createdAt ? new Date(candidate.createdAt).getTime() : now);
      const elapsedMs = now - resumeTime;

      // Send proposal after 10-15 minutes (>= 10 mins)
      if (elapsedMs >= TEN_MINS_MS) {
        console.log(`⏱️ Triggering 10-15 minute delayed interview proposal for ${candidate.name} (+${candidate.phone})`);
        sendInterviewSlotProposal(candidate).catch(err => {
          console.error('Error in sendInterviewSlotProposal:', err.message);
        });
      }
    }
  });
}

// Start Background Automation Scheduler (runs every 60 seconds)
setInterval(runHiringAutomationCheck, 60 * 1000);

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

/**
 * Send custom message to candidate via WhatsApp and record in history
 */
async function sendMessageToCandidate(candidateId, messageText) {
  const candidate = candidates.find(c => c.id === candidateId || c.phone === cleanPhone(candidateId));
  if (!candidate) {
    throw new Error('Candidate not found');
  }

  const cleanText = String(messageText || '').trim();
  if (!cleanText) {
    throw new Error('Message text cannot be empty');
  }

  const res = await whatsappCloudService.sendWhatsAppText(candidate.whatsappChatId || candidate.phone, cleanText);
  appendChatHistory(candidate, 'assistant', cleanText);
  candidate.updatedAt = new Date().toISOString();
  saveCandidatesAndSyncExcel();

  if (ioInstance) {
    ioInstance.emit('hiring-updated', {
      candidates: candidates,
      candidateId: candidate.id,
      candidate: candidate,
      newMessage: {
        role: 'assistant',
        text: cleanText,
        timestamp: new Date().toISOString()
      }
    });
  }

  return { candidate, message: cleanText, res };
}

function deleteCandidate(candidateIdOrPhone) {
  const target = String(candidateIdOrPhone || '').trim();
  const cleanedTarget = cleanPhone(target);
  const index = candidates.findIndex(c => c.id === target || (c.phone && cleanPhone(c.phone) === cleanedTarget) || (cleanedTarget && c.phone && cleanPhone(c.phone).endsWith(cleanedTarget)));
  if (index === -1) {
    return false;
  }
  const deleted = candidates.splice(index, 1)[0];
  if (deleted && deleted.phone) {
    saveDeletedPhone(deleted.phone);
    if (candidatesCollection) {
      candidatesCollection.deleteOne({
        $or: [
          { id: deleted.id },
          { phone: deleted.phone }
        ]
      }).catch(err => console.warn('⚠️ [MongoDB] Delete notice:', err.message));
    }
  }
  saveCandidatesAndSyncExcel();
  return deleted;
}

/**
 * Restore or import candidates from a JSON backup, safely merging records
 */
function restoreFromBackup(importedCandidates) {
  if (!Array.isArray(importedCandidates)) return 0;
  candidates = mergeCandidates(candidates, importedCandidates);
  saveCandidatesAndSyncExcel();
  if (ioInstance) {
    ioInstance.emit('hiring:update', {
      candidates: candidates,
      stats: getHiringStats()
    });
  }
  return candidates.length;
}

module.exports = {
  initMongoDb,
  setHiringIo,
  loadCandidates,
  getCandidates: () => {
    return [...candidates].sort((a, b) => {
      const getLatestTime = (cand) => {
        if (cand.chatHistory && cand.chatHistory.length > 0) {
          const last = cand.chatHistory[cand.chatHistory.length - 1];
          if (last.timestamp) return new Date(last.timestamp).getTime();
        }
        return new Date(cand.updatedAt || cand.createdAt || 0).getTime();
      };
      return getLatestTime(b) - getLatestTime(a);
    });
  },
  getHiringStats,
  saveCandidatesAndSyncExcel,
  restoreFromBackup,
  trackCandidateFromMessage,
  appendChatHistory,
  markCandidateMessagesRead,
  scheduleInterview,
  sendResumeReminder,
  sendInterview1HrReminder,
  getCandidateDisplayName,
  getCandidateSalutation,
  cleanCandidateName,
  extractNameFromResumeFilename,
  getWelcomeRolesReply,
  getRoleSelectedReply,
  getExperienceAnsweredReply,
  isValidPortfolioUrl,
  isThirdPartyRecruitmentForward,
  handleHrWhatsAppCommand,
  sendMessageToCandidate,
  deleteCandidate,
  getDeletedPhones,
  saveDeletedPhone,
  removeDeletedPhone,
  CANDIDATES_JSON_FILE,
  CANDIDATES_BACKUP_FILE,
  CANDIDATES_EXCEL_FILE,
  DELETED_PHONES_FILE
};


