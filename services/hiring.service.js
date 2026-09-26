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

    mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 15000,
      family: 4,
      tls: true
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    candidatesCollection = mongoDb.collection(colName);
    console.log(`🍃 [MongoDB Atlas] Connected successfully to "${dbName}" -> "${colName}"!`);

    // Fetch cloud candidates & safely merge with local candidates (Two-way non-destructive sync)
    const cloudDocs = await candidatesCollection.find({}).toArray();
    if (cloudDocs.length > 0) {
      const cloudCandidates = cloudDocs.map(c => {
        const { _id, ...rest } = c;
        return { ...rest, id: rest.id || String(_id) };
      });
      // Non-destructive merge: preserve both cloud and local records and all chats
      candidates = mergeCandidates(candidates, cloudCandidates);
      console.log(`🍃 [MongoDB Atlas] Synchronized & merged ${cloudDocs.length} cloud records with local candidates! Total: ${candidates.length}`);
      saveCandidatesAndSyncExcel(true);
      if (ioInstance) {
        ioInstance.emit('hiring:update', {
          candidates: candidates,
          stats: getHiringStats()
        });
      }
    } else if (candidates.length > 0) {
      console.log(`🍃 [MongoDB Atlas] Cloud collection clean. Seeding ${candidates.length} local candidates into cloud collection...`);
      for (const c of candidates) {
        if (!c || !c.phone) continue;
        const { _id, ...updateDoc } = c;
        await candidatesCollection.updateOne(
          { phone: c.phone },
          {
            $set: updateDoc,
            $setOnInsert: { _id: c.id || String(Date.now() + Math.random()) }
          },
          { upsert: true }
        );
      }
      console.log('🍃 [MongoDB Atlas] Cloud collection seeded successfully!');
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

    // Filter known spam entities only (never drop candidates named 'Candidate' or with pending names)
    const name = (c.name || '').trim().toLowerCase();
    if (name.includes('dainik bhaskar') || name.includes('bct consulting') || name.includes('ultramodern technologies')) return;

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
        workType: base.workType || fallback.workType || 'Full-Time',
        experience: base.experience || fallback.experience || '',
        portfolio: base.portfolio || fallback.portfolio || '',
        socialHandle: base.socialHandle || fallback.socialHandle || '',
        followers: base.followers || fallback.followers || '',
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

  // 3. Always check snapshots in backups/ to recover and merge any historical candidates & chats
  if (fs.existsSync(BACKUPS_DIR)) {
    try {
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length > 0) {
        const latestSnapshot = path.join(BACKUPS_DIR, files[0]);
        const sData = fs.readFileSync(latestSnapshot, 'utf8');
        const sParsed = JSON.parse(sData);
        if (Array.isArray(sParsed) && sParsed.length > 0) {
          backupList = [...backupList, ...sParsed];
        }
      }
    } catch (e) {}
  }

  // 4. Merge candidates safely across all sources (preventing data loss on git pull, git push, or redeploys)
  candidates = mergeCandidates(primaryList, backupList);

  candidates.forEach(candidate => {
    if (candidate.unreadCount === undefined) {
      candidate.unreadCount = 0;
    }
  });

  console.log(`📋 Candidates Loaded: ${candidates.length} active candidates in pipeline.`);

  // Auto-sync back to primary and mirror backup if we merged or recovered data
  if (candidates.length > 0 && (!fs.existsSync(CANDIDATES_JSON_FILE) || primaryList.length === 0)) {
    saveCandidatesAndSyncExcel();
  }
}

/**
 * Format and generate Excel Workbook for any list of candidates
 */
function generateExcelWorkbook(candidateList = []) {
  const excelRows = (candidateList || []).map((c, index) => {
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
      'Work Mode': c.workType || 'Full-Time',
      'Interview Mode': c.interviewMode === 'online' ? 'Online (Google Meet)' : 'In-Person (Indore Office)',
      'Resume Received': c.resumeReceived ? 'YES' : 'PENDING',
      'Portfolio / Drive / Social Link': c.portfolio || (c.socialHandle ? `Social: ${c.socialHandle} (${c.followers || 'N/A'})` : ''),
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

  const worksheet = xlsx.utils.json_to_sheet(excelRows);

  worksheet['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 20 }, // Name
    { wch: 18 }, // Phone
    { wch: 22 }, // Role
    { wch: 16 }, // Work Mode
    { wch: 24 }, // Interview Mode
    { wch: 16 }, // Resume Received
    { wch: 32 }, // Portfolio / Social Link
    { wch: 20 }, // Status
    { wch: 24 }, // Interview Date & Time
    { wch: 16 }, // Experience
    { wch: 14 }, // City
    { wch: 22 }, // Resume Reminder
    { wch: 22 }, // Interview Reminder
    { wch: 22 }, // Applied Date
    { wch: 30 }, // Last Message
    { wch: 25 }  // Notes
  ];

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Candidates Hiring');
  return workbook;
}

/**
 * Generate Excel binary buffer for streaming or downloading
 */
function generateExcelBuffer(candidateList = []) {
  const workbook = generateExcelWorkbook(candidateList);
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Filter candidates by role, timeframe (24h, today, 7d, etc.), status, and search
 */
function getFilteredCandidates(filters = {}) {
  const {
    role,
    timeframe = 'all',
    status,
    search,
    dateBasis = 'applied',
    startDate,
    endDate
  } = filters;

  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;

  // Calculate India (Asia/Kolkata) today boundaries
  const nowInIndia = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayStartIndia = new Date(nowInIndia.getFullYear(), nowInIndia.getMonth(), nowInIndia.getDate()).getTime();
  const yesterdayStartIndia = todayStartIndia - ONE_DAY;

  return candidates.filter(c => {
    if (!c) return false;

    // 1. Role Filter
    if (role && role !== 'all') {
      const candRole = (c.role || '').toLowerCase();
      const targetRole = role.toLowerCase().trim();

      if (targetRole === 'telecaller') {
        if (!candRole.includes('telecaller') && !candRole.includes('telecoler') && !candRole.includes('inside sales') && !candRole.includes('calling')) {
          return false;
        }
      } else if (targetRole === 'sales') {
        if (!candRole.includes('sales')) {
          return false;
        }
      } else if (targetRole === 'accountant') {
        if (!candRole.includes('account') && !candRole.includes('finance') && !candRole.includes('tally')) {
          return false;
        }
      } else if (candRole !== targetRole && !candRole.includes(targetRole) && !targetRole.includes(candRole)) {
        return false;
      }
    }

    // 2. Status Filter
    if (status && status !== 'all') {
      const candStatus = (c.status || '').toLowerCase();
      const targetStatus = status.toLowerCase();
      if (candStatus !== targetStatus && !candStatus.includes(targetStatus)) {
        return false;
      }
    }

    // 3. Timeframe / Date Filter
    if (timeframe && timeframe !== 'all') {
      let candDateMs = null;
      if (dateBasis === 'interview' && c.interviewDateTime) {
        candDateMs = new Date(c.interviewDateTime).getTime();
      } else if (dateBasis === 'activity') {
        candDateMs = new Date(c.updatedAt || c.createdAt || 0).getTime();
      } else {
        // default: applied date, fall back to updatedAt
        candDateMs = new Date(c.createdAt || c.updatedAt || 0).getTime();
      }

      if (!candDateMs || isNaN(candDateMs)) return false;

      if (timeframe === '24h') {
        if ((now - candDateMs) > (24 * ONE_HOUR)) return false;
      } else if (timeframe === 'today') {
        const cDateIndia = new Date(new Date(candDateMs).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getTime();
        if (cDateIndia < todayStartIndia) return false;
      } else if (timeframe === 'yesterday') {
        const cDateIndia = new Date(new Date(candDateMs).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getTime();
        if (cDateIndia < yesterdayStartIndia || cDateIndia >= todayStartIndia) return false;
      } else if (timeframe === '7d') {
        if ((now - candDateMs) > (7 * ONE_DAY)) return false;
      } else if (timeframe === '30d') {
        if ((now - candDateMs) > (30 * ONE_DAY)) return false;
      } else if (timeframe === 'custom') {
        if (startDate && candDateMs < new Date(startDate).getTime()) return false;
        if (endDate && candDateMs > (new Date(endDate).getTime() + ONE_DAY)) return false;
      }
    }

    // 4. Search Filter
    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      const matches = (
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.role && c.role.toLowerCase().includes(q)) ||
        (c.city && c.city.toLowerCase().includes(q)) ||
        (c.experience && c.experience.toLowerCase().includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q))
      );
      if (!matches) return false;
    }

    return true;
  });
}

/**
 * Save candidates to JSON, Mirror Backup, Hourly Snapshot, and Excel file
 */
function saveCandidatesAndSyncExcel(syncToMongo = true) {
  try {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      if (fs.existsSync(CANDIDATES_JSON_FILE)) {
        try {
          const diskData = JSON.parse(fs.readFileSync(CANDIDATES_JSON_FILE, 'utf8'));
          if (Array.isArray(diskData) && diskData.length > 0) {
            console.warn('⚠️ [Data Protection] Blocked destructive overwrite: candidates array is empty while on-disk data exists.');
            return;
          }
        } catch (e) {}
      }
    }

    const jsonStr = JSON.stringify(candidates, null, 2);

    // 1. Save Primary JSON
    fs.writeFileSync(CANDIDATES_JSON_FILE, jsonStr, 'utf8');

    // 2. Save Redundant Mirror Backup (Untracked by Git, completely safe)
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
            if (!c || !c.phone) continue;
            try {
              const { _id, ...updateDoc } = c;
              await candidatesCollection.updateOne(
                { phone: c.phone },
                {
                  $set: updateDoc,
                  $setOnInsert: { _id: c.id || String(Date.now() + Math.random()) }
                },
                { upsert: true }
              );
            } catch (singleErr) {
              console.warn(`⚠️ [MongoDB] Single candidate sync notice (${c.phone}):`, singleErr.message);
            }
          }
        } catch (mErr) {
          console.warn('⚠️ [MongoDB] Background sync notice:', mErr.message);
        }
      });
    }

    // 2. Generate and write full Excel workbook
    const workbook = generateExcelWorkbook(candidates);
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
    'chahiye', 'batao', 'bhejo', 'send', 'share', 'contact', 'number', 'phone',
    'image', 'images', 'photo', 'photos', 'pic', 'pics', 'picture', 'pictures',
    'screenshot', 'screenshots', 'document', 'documents', 'doc', 'docs',
    'file', 'files', 'media', 'attachment', 'scan', 'camscanner', 'whatsapp', 'img', 'audio'
  ]);

  const lowerWords = cleaned.toLowerCase().split(' ').filter(Boolean);
  if (lowerWords.length === 0) return 'Candidate';

  if (lowerWords.every(w => blacklistedWords.has(w)) || lowerWords.some(w => ['looking', 'applying', 'interested', 'fresher', 'intern', 'student', 'candidate', 'customer', 'image', 'screenshot', 'photo', 'document'].includes(w))) {
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
  base = base.replace(/\b(?:resume|cv|biodata|bio\s*data|curriculum|vitae|updated|update|new|final|latest|profile|document|doc|pdf|png|jpg|jpeg|draft|brandsetu|image|images|photo|photos|pic|pics|picture|screenshot|screenshots|attachment|scan|camscanner|img|file|files|media)\b/gi, ' ');
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
 * Welcome & Roles Response (Step 0 -> Step 1: Initial Ad click / Greeting / Inquiry)
 */
function getWelcomeRolesReply(lang = 'english') {
  const isHi = (lang === 'hinglish' || lang === 'hindi');
  if (isHi) {
    return `Brand Setu Digital me aapka swagat hai! 🎉\n\nHum in active positions aur collaborations ke liye onboarding kar rahe hain:\n1️⃣ 🎬 *Video Editor*\n2️⃣ 🤖 *AI Video Expert*\n3️⃣ 🎨 *Graphic Designer*\n4️⃣ 🔎 *SEO & AEO Expert*\n5️⃣ 📱 *Social Media Manager*\n6️⃣ 📢 *Digital Marketing Manager*\n7️⃣ ✨ *Influencer Collaboration!*\n\n💼 *Note:* Agar aap kisi anya *Digital Marketing Role* (SEO, SMM, Lead Gen, Content Writer, Web Developer, Telecaller, etc.) ke liye apply karna chahte hain, toh aap uska naam bhi likh sakte hain.\n\n👉 Aap **kis position ya collaboration** ke liye apply/connect kar rahe hain? (1 to 7 number ya role ka naam likhein) 📝`;
  }
  return `Welcome to Brand Setu Digital! 🎉\n\nWe are actively onboarding for these positions and collaborations:\n1️⃣ 🎬 *Video Editor*\n2️⃣ 🤖 *AI Video Expert*\n3️⃣ 🎨 *Graphic Designer*\n4️⃣ 🔎 *SEO & AEO Expert*\n5️⃣ 📱 *Social Media Manager*\n6️⃣ 📢 *Digital Marketing Manager*\n7️⃣ ✨ *Influencer Collaboration!*\n\n💼 *Note:* If you are applying for any other *Digital Marketing Role* (SEO, SMM, Lead Gen, Content Writer, Web Developer, Telecaller, etc.), you can also reply with your role name.\n\n👉 Which **position or collaboration** would you like to apply for? (Please reply with number 1 to 7 or the name) 📝`;
}

/**
 * Role Selected Response (Step 1 -> Step 2 transition)
 */
function getRoleSelectedReply(role, lang = 'english') {
  const isHi = (lang === 'hinglish' || lang === 'hindi');

  // Special Track: Influencer Collaboration
  if (role === 'Influencer Collaboration' || (role && role.toLowerCase().includes('influencer'))) {
    return `Influencer Collaboration! ✨\n\nWe’d love to know a little more about you and your content before taking the collaboration forward.\n\nPlease fill out this short form with your basic details, social media profile, audience insights & collaboration information:\n\n1️⃣ Aap kis prakar ke video/content banate hain? (Niche: Tech, Lifestyle, Comedy, Fashion, Education, etc.)\n2️⃣ Aapka Instagram / YouTube profile link ya handle (@username) kya hai?\n3️⃣ Instagram par aapke kitne followers hain aur average views kitne aate hain?\n4️⃣ Aap kis type ki collaboration prefer karte hain? (Paid Reel, Barter, Campaign, Brand Ambassador) 🤝`;
  }

  // Tailored Track: Video Editor
  if (role === 'Video Editor' || (role && role.toLowerCase().includes('video editor'))) {
    if (isHi) {
      return `Bahut badiya! Aapne *Video Editor* select kiya hai. 🎬👍\n\nKripya batayein:\n1️⃣ Aap kaunse software use karte hain? (Premiere Pro, After Effects, DaVinci Resolve, CapCut Pro)\n2️⃣ Kis type ke videos edit karte hain? (Instagram Reels/Shorts, YouTube long-form, Commercial Ads, Motion Graphics)\n3️⃣ Aapko kitna experience hai (Fresher / Experienced)? 💼`;
    }
    return `Great! You have selected *Video Editor*. 🎬👍\n\nPlease let us know:\n1️⃣ Which software do you use? (Premiere Pro, After Effects, DaVinci Resolve, CapCut Pro)\n2️⃣ What type of videos do you edit? (Reels/Shorts, YouTube long-form, Commercial Ads, Motion Graphics)\n3️⃣ How much experience do you have (Fresher / Experienced)? 💼`;
  }

  // Tailored Track: Other Roles (Content Writer, Web Developer, Telecaller, Sales, Accounts, HR, etc.)
  if (role === 'Other Digital Marketing Roles' || (role && (
    role.toLowerCase().includes('content') ||
    role.toLowerCase().includes('web') ||
    role.toLowerCase().includes('digital marketing') ||
    role.toLowerCase().includes('telecaller') ||
    role.toLowerCase().includes('tele') ||
    role.toLowerCase().includes('sales') ||
    role.toLowerCase().includes('account') ||
    role.toLowerCase().includes('hr') ||
    role.toLowerCase().includes('admin') ||
    role.toLowerCase().includes('inside sales')
  ))) {
    if (isHi) {
      return `Bahut badiya! Aapne *${role}* select kiya hai. 💼✨\n\nKripya batayein:\n1️⃣ Aapka is field me kitna experience hai (Fresher / Experienced)?\n2️⃣ Aapki core skills aur tools kya hain? 📝`;
    }
    return `Great! You have selected *${role}*. 💼✨\n\nPlease let us know:\n1️⃣ How much experience do you have in this field (Fresher / Experienced)?\n2️⃣ What are your core skills and tools? 📝`;
  }

  // Standard Openings (Graphic Designer, AI Video, SEO, Social Media, etc.)
  if (isHi) {
    return `Bahut badiya! Aapne *${role}* select kiya hai. 👍\n\nKripya batayein:\n1️⃣ Aap *Fresher* ke liye apply kar rahe hain ya *Experienced* ke liye? (Agar experienced hain, to kitne time ka experience hai?)\n2️⃣ Aapki core skills aur tools kya hain? 🎨`;
  }
  return `Great! You have selected *${role}*. 👍\n\nPlease let us know:\n1️⃣ Are you applying as a *Fresher* or *Experienced*? (If experienced, how many years/months?)\n2️⃣ What are your core skills and tools? 🎨`;
}

/**
 * Experience Answered Response (Step 2 -> Step 3 transition: Next Process is Resume & Portfolio)
 */
function getExperienceAnsweredReply(candidate, lang = 'english') {
  const isHi = (lang === 'hinglish' || lang === 'hindi');
  const role = (candidate && candidate.role && candidate.role !== 'General Applicant') ? candidate.role : 'Video Editor';
  const candName = (candidate && candidate.name && candidate.name !== 'Candidate') ? candidate.name.split(' ')[0] : '';
  const isWfh = (candidate && (candidate.workType === 'Work From Home' || candidate.workType === 'Freelancer' || (candidate.experience && /wfh|work from home|remote/i.test(candidate.experience))));
  const wfhPrefixHi = isWfh ? 'Remote / Work From Home / Freelancer roles ke liye hamari HR team aapki profile review karne ke baad aapse directly connect karegi. 🤝✨ ' : '';
  const wfhPrefixEn = isWfh ? 'For Remote / Work From Home / Freelancer roles, our HR team will review your profile and connect with you directly. 🤝✨ ' : '';

  if (role === 'Influencer Collaboration' || role.toLowerCase().includes('influencer')) {
    return isHi
      ? `Dhanyawad${candName ? ` ${candName}` : ''}! ✨ Aapki details note kar li gayi hain. Kripya apna Instagram profile link ya insights screenshot yahan share karein, hamari collaboration team aapse jald connect karegi! 🤝`
      : `Thank you${candName ? ` ${candName}` : ''}! ✨ Your details have been noted. Please share your Instagram profile link or insights screenshot here, and our collaboration team will connect with you shortly! 🤝`;
  } else if (role === 'AI Video Expert') {
    return isHi
      ? `Awesome${candName ? ` ${candName}` : ''}! 🤖 ${wfhPrefixHi}Kripya apna updated *Resume (PDF)* aur AI video tools (Runway, Kling, Midjourney, etc.) ke samples ka *Google Drive link* yahan share karein. 📄🎥`
      : `Awesome${candName ? ` ${candName}` : ''}! 🤖 ${wfhPrefixEn}Please share your updated *Resume (PDF)* and your AI video work samples / Google Drive link here. 📄🎥`;
  } else if (role === 'Graphic Designer') {
    return isHi
      ? `Perfect${candName ? ` ${candName}` : ''}! 🎨 ${wfhPrefixHi}Kripya apna updated *Resume (PDF)* aur *Design Portfolio link (Behance / Drive / Figma)* yahan share karein. 📄🎨`
      : `Perfect${candName ? ` ${candName}` : ''}! 🎨 ${wfhPrefixEn}Please share your updated *Resume (PDF)* and your *Design Portfolio (Behance / Drive / Figma link)* here. 📄🎨`;
  } else if (role === 'SEO & AEO Expert') {
    return isHi
      ? `Great${candName ? ` ${candName}` : ''}! 🔎 ${wfhPrefixHi}Kripya apna updated *Resume (PDF)* aur live SEO rankings / case studies details yahan share karein. 📄📊`
      : `Great${candName ? ` ${candName}` : ''}! 🔎 ${wfhPrefixEn}Please share your updated *Resume (PDF)* and your live SEO rankings / case studies proof here. 📄📊`;
  } else if (role === 'Social Media Manager' || role.includes('Social Media')) {
    return isHi
      ? `Super${candName ? ` ${candName}` : ''}! 📱 ${wfhPrefixHi}Kripya apna updated *Resume (PDF)* aur past managed social media profiles / growth proof share karein. 📄🚀`
      : `Super${candName ? ` ${candName}` : ''}! 📱 ${wfhPrefixEn}Please share your updated *Resume (PDF)* and your past managed social media profiles / growth proof here. 📄🚀`;
  } else if (role === 'Digital Marketing Manager') {
    return isHi
      ? `Excellent${candName ? ` ${candName}` : ''}! 📢 ${wfhPrefixHi}Kripya apna updated *Resume (PDF)* aur Ad campaign / ROAS case studies yahan share karein. 📄💼`
      : `Excellent${candName ? ` ${candName}` : ''}! 📢 ${wfhPrefixEn}Please share your updated *Resume (PDF)* and your Ad campaign / ROAS case studies here. 📄💼`;
  } else if (role === 'Video Editor') {
    return isHi
      ? `Bahut badiya${candName ? ` ${candName}` : ''}! 🎬 ${wfhPrefixHi}Kripya apna updated *Resume (PDF)* aur Video Editing ka *Portfolio / Google Drive link* yahan share karein taaki hum aapke best work samples evaluate kar sakein. 📄🎥`
      : `Great${candName ? ` ${candName}` : ''}! 🎬 ${wfhPrefixEn}Please share your updated *Resume (PDF)* and your Video Portfolio / Google Drive link here so we can evaluate your best work samples. 📄🎥`;
  } else {
    return isHi
      ? `Bahut badiya${candName ? ` ${candName}` : ''}! 💼 ${wfhPrefixHi}Kripya apna updated *Resume (PDF)* aur past work samples / portfolio / live links yahan share karein taaki hamari team aapki profile review kar sake. 📄✨`
      : `Great${candName ? ` ${candName}` : ''}! 💼 ${wfhPrefixEn}Please share your updated *Resume (PDF)* and your past work samples / portfolio / live links here so our team can review your profile. 📄✨`;
  }
}

/**
 * Track an outgoing bulk campaign message in candidate pipeline & chat history
 */
function trackOutgoingCampaignMessage(rawPhone, messageText) {
  const phone = cleanPhone(rawPhone);
  if (!phone) return null;

  const nowIso = new Date().toISOString();
  let candidate = candidates.find(c => c.phone && cleanPhone(c.phone) === phone);

  if (!candidate) {
    candidate = {
      id: `cand_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      phone: phone,
      whatsappChatId: null,
      name: 'Candidate',
      role: 'General Applicant',
      workType: 'Full-Time',
      city: 'Indore',
      lang: 'hinglish',
      experience: '',
      portfolio: '',
      socialHandle: '',
      followers: '',
      resumeReceived: false,
      resumeFileName: '',
      status: 'Campaign Sent',
      interviewDateTime: null,
      notes: 'Outreach campaign broadcast sent',
      resumeReminderSent: false,
      resumeReminderSentAt: null,
      interviewReminderSent: false,
      interviewReminderSentAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastMessage: messageText,
      justSelectedRole: false,
      justAnsweredExperience: false,
      chatHistory: []
    };
    candidates.unshift(candidate);
    console.log(`📢 Candidate registered from bulk campaign: +${candidate.phone}`);
  } else {
    // Re-activate if previously closed / not interested so new campaign replies can be qualified
    candidate.closedAt = null;
    candidate.offTopicCount = 0;
    // Clear stale expired past interviews
    if (candidate.interviewDateTime && new Date(candidate.interviewDateTime).getTime() < Date.now()) {
      candidate.interviewDateTime = null;
    }
    candidate.updatedAt = nowIso;
    candidate.lastMessage = messageText;
  }

  appendChatHistory(candidate, 'assistant', messageText);
  saveCandidatesAndSyncExcel();

  if (ioInstance) {
    ioInstance.emit('hiring:update', {
      candidates: candidates,
      stats: getHiringStats()
    });
  }

  return candidate;
}

/**
 * Handle incoming message for Candidate Tracking & State Management
 */
function trackCandidateFromMessage(messageData) {
  const phone = cleanPhone(messageData.customerPhone || messageData.phone || messageData.sender);
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

  // Check if this is a fresh application intent (e.g. candidate clicks Instagram Ad, types "apply", "new apply", "restart", "start", or sends ad greeting)
  const isFreshApplyIntent = (
    lower === 'apply' ||
    lower === 'new apply' ||
    lower === 'restart' ||
    lower.startsWith('apply for') ||
    lower.startsWith('apply ') ||
    lower.includes('can i get more info') ||
    lower.includes('looking for job') ||
    lower.includes('hiring ke liye')
  );

  // Check if candidate is currently awaiting Step 2 (Experience / Qualification / Work mode)
  const isAwaitingExperience = !isFreshApplyIntent && candidate && candidate.role && candidate.role !== 'General Applicant' && (!candidate.experience || candidate.experience === '');

  const cleanTrimmed = lower.replace(/[^\w\s]/g, '').trim();
  let detectedRole = null;
  let detectedExperience = null;

  // 1. Detect Work Mode preference (Freelancer, Work From Home, Part-Time, Full-Time)
  let detectedWorkType = null;
  if (lower.includes('freelance') || lower.includes('freelancer') || lower.includes('freelancing') || lower.includes('project basis')) {
    detectedWorkType = 'Freelancer';
  } else if (lower.includes('wfh') || lower.includes('work from home') || lower.includes('remote') || lower.includes('ghar se')) {
    detectedWorkType = 'Work From Home';
  } else if (lower.includes('part time') || lower.includes('parttime') || lower.includes('half day') || /(?:\b(?:2|3|4|5)\s*(?:and\s*(?:a\s*)?half\s*)?(?:hr|hrs|hour|hours|ghante|ghanta)\b)/i.test(lower)) {
    detectedWorkType = 'Part-Time';
  } else if (lower.includes('full time') || lower.includes('full-time') || lower.includes('fulltime') || lower.includes('in office') || lower.includes('in-office') || lower.includes('onsite')) {
    detectedWorkType = 'Full-Time';
  }

  // 2. Detect Influencer details (social handles & followers)
  let detectedSocialHandle = null;
  let detectedFollowers = null;
  const handleMatch = text.match(/(?:@|https?:\/\/(?:www\.)?instagram\.com\/|https?:\/\/(?:www\.)?youtube\.com\/(?:@)?)([A-Za-z0-9._]{3,30})/i);
  if (handleMatch) {
    detectedSocialHandle = handleMatch[0];
  }
  const followerMatch = text.match(/(\d+(?:\.\d+)?\s*(?:k|m|million|lakh|thousand|followers|subs|subscribers)\b)/i);
  if (followerMatch) {
    detectedFollowers = followerMatch[1];
  }

  const expMatch = text.match(/(\d+(?:\.\d+)?\s*(?:year|yr|saal|month|mahine|yrs|mths)\b(?:[^\n,]*experience)?)/i) ||
                   text.match(/(?:experience|exp|experience:)\s*(\d+(?:\.\d+)?(?:\s*(?:year|yr|saal|month|mahine|yrs|mths))?)/i) ||
                   text.match(/^\s*(\d+(?:\.\d+)?)\s*$/m);

  const isFresherOrIntern = lower.includes('fresher') || lower.includes('freshor') || lower.includes('internship') || lower.includes('intern') || lower.includes('no experience') || lower.includes('learning');
  const isFullTimeOrExp = lower.includes('full time') || lower.includes('full-time') || lower.includes('fulltime') || lower.includes('experienced') || lower.includes('experience');

  if (isAwaitingExperience) {
    // If candidate replied with Influencer details or Work Mode or Experience
    if (candidate && candidate.role === 'Influencer Collaboration') {
      detectedExperience = detectedFollowers ? `${detectedFollowers} followers` : (text.length > 5 ? text.substring(0, 80) : 'Influencer Profile');
    } else if (cleanTrimmed === '1' || isFresherOrIntern) {
      detectedExperience = detectedWorkType ? `Fresher (${detectedWorkType})` : 'Fresher (Paid Internship)';
    } else if (cleanTrimmed === '2' || isFullTimeOrExp || expMatch) {
      const rawExp = expMatch ? (expMatch[1] || expMatch[0]) : null;
      const formattedExp = rawExp ? ((rawExp.includes('year') || rawExp.includes('month') || rawExp.includes('yr')) ? rawExp : `${rawExp} years`) : null;
      const baseExp = formattedExp ? (isFullTimeOrExp ? `Full-Time (${formattedExp})` : formattedExp) : 'Experienced';
      detectedExperience = detectedWorkType ? `${baseExp} [${detectedWorkType}]` : baseExp;
    } else if (detectedWorkType) {
      detectedExperience = `Work Mode: ${detectedWorkType}`;
    } else if (text.length > 3) {
      detectedExperience = text.substring(0, 80);
    }
  } else {
    // Strip URLs and document filenames so tool names in URLs/filenames (e.g. canva.site, figma.com, behance.net) don't trigger roles
    const textForRole = text
      .replace(/https?:\/\/[^\s]+/gi, ' ')
      .replace(/\b[a-zA-Z0-9._-]+\.(?:pdf|png|jpg|jpeg|docx?)\b/gi, ' ')
      .trim();
    const lowerForRole = textForRole.toLowerCase();
    const cleanTrimmedForRole = lowerForRole.replace(/[^\w\s]/g, '').trim();

    // Step 1: Detect Role from options 1 to 7 or keywords
    if (cleanTrimmedForRole === '1' || cleanTrimmedForRole.startsWith('1 ') || lowerForRole.includes('video editor') || lowerForRole.includes('video editing') || lowerForRole.includes('reels edit') || lowerForRole.includes('premiere') || lowerForRole.includes('after effects') || lowerForRole.includes('davinci')) {
      detectedRole = 'Video Editor';
    } else if (cleanTrimmedForRole === '2' || cleanTrimmedForRole.startsWith('2 ') || lowerForRole.includes('ai video') || lowerForRole.includes('ai reels') || lowerForRole.includes('runway') || lowerForRole.includes('kling') || lowerForRole.includes('midjourney') || lowerForRole.includes('pika') || lowerForRole.includes('heygen')) {
      detectedRole = 'AI Video Expert';
    } else if (cleanTrimmedForRole === '3' || cleanTrimmedForRole.startsWith('3 ') || lowerForRole.includes('graphic') || lowerForRole.includes('designer') || lowerForRole.includes('designing') || lowerForRole.includes('photoshop') || lowerForRole.includes('illustrator') || lowerForRole.includes('logo design') || lowerForRole.includes('poster design') || lowerForRole.includes('banner design') || /(?:canva|figma)\s*(?:design|designer)/i.test(lowerForRole)) {
      detectedRole = 'Graphic Designer';
    } else if (cleanTrimmedForRole === '4' || cleanTrimmedForRole.startsWith('4 ') || lowerForRole.includes('seo') || lowerForRole.includes('aeo') || lowerForRole.includes('search engine') || lowerForRole.includes('ranking') || lowerForRole.includes('backlink')) {
      detectedRole = 'SEO & AEO Expert';
    } else if (cleanTrimmedForRole === '5' || cleanTrimmedForRole.startsWith('5 ') || lowerForRole.includes('social media') || lowerForRole.includes('smm') || lowerForRole.includes('instagram manager') || lowerForRole.includes('social manager')) {
      if (lowerForRole.includes('content writer') || lowerForRole.includes('content writing') || lowerForRole.includes('copywriter')) {
        detectedRole = 'Social Media Manager & Content Writer';
      } else {
        detectedRole = 'Social Media Manager';
      }
    } else if (cleanTrimmedForRole === '6' || cleanTrimmedForRole.startsWith('6 ') || lowerForRole.includes('performance marketing') || lowerForRole.includes('media buyer') || lowerForRole.includes('meta ads') || lowerForRole.includes('facebook ads') || lowerForRole.includes('google ads') || (lowerForRole.includes('digital marketing') && (lowerForRole.includes('manager') || lowerForRole.includes('lead') || lowerForRole.includes('head')))) {
      detectedRole = 'Digital Marketing Manager';
    } else if (lowerForRole.includes('content writer') || lowerForRole.includes('copywriter') || lowerForRole.includes('content writing') || lowerForRole.includes('blog writer') || lowerForRole.includes('article writer') || lowerForRole.includes('script writer')) {
      detectedRole = 'Content Writer / Copywriter';
    } else if (lowerForRole.includes('web developer') || lowerForRole.includes('website developer') || lowerForRole.includes('wordpress') || lowerForRole.includes('frontend') || lowerForRole.includes('fullstack') || lowerForRole.includes('backend') || lowerForRole.includes('web development') || lowerForRole.includes('website designer')) {
      detectedRole = 'Web Developer';
    } else if (
      /(?:tele\s*col[le]r|tele\s*call(?:er|ing)?|tele\s*sales|inside\s*sales|bpo|voice\s*process)/i.test(lowerForRole) ||
      (/\b(?:calling|caller|telecall)\b/i.test(lowerForRole) && !/(?:call\s*me|call\s*back|phone\s*no|contact\s*no)/i.test(lowerForRole))
    ) {
      if (lowerForRole.includes('sales')) {
        detectedRole = 'Telecaller / Sales Executive';
      } else {
        detectedRole = 'Telecaller / Inside Sales';
      }
    } else if (
      /(?:sales\s*executive|sales\s*manager|sales\s*job|sales\s*role|sales\s*work|field\s*sales|bda|bde|business\s*development|\bmarketing\s*sales\b)/i.test(lowerForRole) ||
      (/\bsales\b/i.test(lowerForRole) && !/(?:point\s*of\s*sale|sales\s*tax)/i.test(lowerForRole))
    ) {
      detectedRole = 'Sales Executive';
    } else if (/(?:accountant|accounting|accounts|tally|finance|billing)/i.test(lowerForRole)) {
      detectedRole = 'Accountant / Finance';
    } else if (/(?:hr\s*recruiter|hr\s*executive|human\s*resource|talent\s*acquisition|\brecruiter\b|\brecruitment\b)/i.test(lowerForRole)) {
      detectedRole = 'HR Recruiter / HR Executive';
    } else if (/(?:receptionist|front\s*desk|office\s*assistant|back\s*office|data\s*entry|computer\s*operator)/i.test(lowerForRole)) {
      detectedRole = 'Office Admin / Back Office';
    } else if (cleanTrimmedForRole === '7' || cleanTrimmedForRole.startsWith('7 ') || cleanTrimmedForRole === '8' || cleanTrimmedForRole.startsWith('8 ') || lowerForRole.includes('influencer') || lowerForRole.includes('collab') || lowerForRole.includes('collaboration') || lowerForRole.includes('pr package') || lowerForRole.includes('brand deal') || lowerForRole.includes('sponsorship') || (lowerForRole.includes('creator') && !lowerForRole.includes('social') && !lowerForRole.includes('editor') && !lowerForRole.includes('designer') && !lowerForRole.includes('writer'))) {
      detectedRole = 'Influencer Collaboration';
      if (!detectedWorkType) detectedWorkType = 'Influencer Collaboration';
    } else if (lowerForRole.includes('lead gen') || lowerForRole.includes('digital marketing') || lowerForRole.includes('marketing')) {
      detectedRole = 'Other Digital Marketing Roles';
    }

    // Dynamic extraction if candidate says "apply for XYZ" or "XYZ ke liye apply"
    if (!detectedRole) {
      const explicitRoleMatch = lowerForRole.match(/(?:apply(?:ing)?\s*(?:for|as|karna|krna)?|interested\s*in|ke\s*liye\s*apply|role\s*(?:of|is|[:=-]))\s*([a-zA-Z\s]{3,30})/i);
      if (explicitRoleMatch && explicitRoleMatch[1]) {
        const potentialRole = explicitRoleMatch[1].trim();
        const nonRoleWords = ['job', 'interview', 'work', 'internship', 'fresher', 'experience', 'sir', 'maam', 'brandsetu', 'indore', 'here', 'please', 'details', 'urgent', 'karna', 'krna', 'hai', 'h'];
        if (!nonRoleWords.includes(potentialRole.toLowerCase()) && potentialRole.length >= 3) {
          detectedRole = potentialRole.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
      }
    }

    // Capture experience if explicitly stated in initial role message (exclude single menu choice digits 1-7)
    const isSingleRoleChoiceDigit = /^[1-7]$/.test(cleanTrimmedForRole);
    if (detectedRole && !isSingleRoleChoiceDigit && (isFresherOrIntern || isFullTimeOrExp || expMatch || detectedWorkType)) {
      if (isFresherOrIntern) {
        detectedExperience = detectedWorkType ? `Fresher (${detectedWorkType})` : 'Fresher (Paid Internship)';
      } else if (expMatch) {
        const rawExp = expMatch[1] || expMatch[0];
        const formattedExp = (rawExp.includes('year') || rawExp.includes('month') || rawExp.includes('yr')) ? rawExp : `${rawExp} years`;
        detectedExperience = detectedWorkType ? `${formattedExp} [${detectedWorkType}]` : (isFullTimeOrExp ? `Full-Time (${formattedExp})` : formattedExp);
      } else if (isFullTimeOrExp || detectedWorkType) {
        detectedExperience = detectedWorkType ? `Preferred: ${detectedWorkType}` : 'Experienced';
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
      workType: detectedWorkType || (detectedRole === 'Influencer Collaboration' ? 'Influencer Collaboration' : 'Full-Time'),
      city: 'Indore',
      lang: msgLang,
      experience: detectedExperience || '',
      portfolio: extractedLink,
      socialHandle: detectedSocialHandle || '',
      followers: detectedFollowers || '',
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
    console.log(`📋 New Candidate Registered: ${candidate.name} (+${candidate.phone}) for ${candidate.role} [WorkType: ${candidate.workType}]`);
  } else {
    // Update existing candidate
    if (messageData.chatId) candidate.whatsappChatId = messageData.chatId;
    candidate.updatedAt = nowIso;
    candidate.lastMessage = text;
    if (text) candidate.lang = msgLang;
    if (detectedWorkType) candidate.workType = detectedWorkType;
    if (detectedSocialHandle) candidate.socialHandle = detectedSocialHandle;
    if (detectedFollowers) candidate.followers = detectedFollowers;
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
    } else if (detectedRole && candidate.role === 'General Applicant') {
      console.log(`🎯 Candidate ${candidate.name} (+${candidate.phone}) selected role: ${detectedRole}`);
      candidate.role = detectedRole;
      if (detectedExperience) {
        candidate.experience = detectedExperience;
        candidate.justAnsweredExperience = true;
      } else {
        candidate.experience = '';
        candidate.justSelectedRole = true;
      }
    } else if (detectedRole && candidate.role && candidate.role !== 'General Applicant' && candidate.role !== detectedRole) {
      // Role lock: If candidate is submitting a resume or portfolio, NEVER switch their role!
      const isSubmittingPortfolioOrResume = hasResumeSignal || hasValidDocumentUpload || msgType === 'document' || text.toLowerCase().includes('.pdf');

      // Only change role if candidate explicitly states a switch request and is NOT submitting resume/portfolio
      const isExplicitSwitch = !isSubmittingPortfolioOrResume && (
        /^(?:switch\s*(?:to|role)|change\s*role|apply\s*for|now\s*applying|instead|role\s*badal)/i.test(text) ||
        (/^[1-7]$/.test(cleanTrimmed) && (!candidate.experience || candidate.experience === ''))
      );

      if (isExplicitSwitch) {
        console.log(`🎯 Candidate ${candidate.name} (+${candidate.phone}) switched role: ${candidate.role} -> ${detectedRole}`);
        candidate.role = detectedRole;
        if (detectedExperience) {
          candidate.experience = detectedExperience;
          candidate.justAnsweredExperience = true;
        } else if (!candidate.experience) {
          candidate.experience = '';
          candidate.justSelectedRole = true;
        }
      }
    } else if (isAwaitingExperience && detectedExperience) {
      console.log(`💼 Candidate ${candidate.name} (+${candidate.phone}) provided experience: ${detectedExperience}`);
      candidate.experience = detectedExperience;
      candidate.justAnsweredExperience = true;
    } else if (detectedExperience && (!candidate.experience || candidate.experience === '')) {
      candidate.experience = detectedExperience;
      candidate.justAnsweredExperience = true;
    }

    if (detectedWorkType) {
      candidate.workType = detectedWorkType;
      if (detectedWorkType === 'Work From Home' || detectedWorkType === 'Freelancer') {
        candidate.interviewMode = 'online';
      }
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

  let interviewDate = new Date(interviewDateTime);
  if (isNaN(interviewDate.getTime())) {
    throw new Error('Invalid interview date & time');
  }

  // Extract IST (Asia/Kolkata) date & time components reliably across any server OS/timezone
  const istParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(interviewDate);
  const partMap = {};
  istParts.forEach(p => partMap[p.type] = p.value);
  const iYear = partMap.year;
  const iMonth = partMap.month;
  const iDay = partMap.day;
  let iHour = parseInt(partMap.hour, 10);
  let iMinute = parseInt(partMap.minute, 10);

  // If time is missing, UTC-midnight in IST (05:30), 00:00 midnight, or outside office hours (<10 or >19):
  // Default strictly to 10:30 AM in the morning
  if ((iHour === 5 && iMinute === 30) || (iHour === 0 && iMinute === 0) || iHour < 10 || iHour > 19) {
    iHour = 10;
    iMinute = 30;
    // Reconstruct normalized Date object at 10:30 AM IST (+05:30)
    interviewDate = new Date(`${iYear}-${iMonth}-${iDay}T10:30:00+05:30`);
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

      // Format dynamic Date (DD/MM/YYYY) and Time (Asia/Kolkata)
      const dateFormatted = `${iDay}/${iMonth}/${iYear}`;
      const ampm = iHour >= 12 ? 'pm' : 'am';
      const h12 = iHour % 12 || 12;
      const timeFormatted = `${String(h12).padStart(2, '0')}:${String(iMinute).padStart(2, '0')} ${ampm}`;

      const candidateDisplayName = (candidate && candidate.name && candidate.name !== 'Candidate' && candidate.name !== 'General Applicant') ? candidate.name : 'Candidate';

      if (isOnline) {
        if (isEnglish) {
          confirmMsg = isRescheduled
            ? `${salutationEn} 🔄\n\nYour *Online Google Meet Interview* for the *${candidate.role || 'Job'}* position at *BrandSetu Digital* has been *rescheduled successfully*. 💻✨\n\n📅 *Updated Date & Time:* ${dateFormatted} at ${timeFormatted}\n🔗 *Platform:* Google Meet (Online)\n📌 *Important Note:* You will receive the Google Meet joining link here on WhatsApp 15 minutes before the interview starts.\n\nSee you then! 👍\n- HR Team, BrandSetu Digital (+91 9329232025)`
            : `${salutationEn} 🎉\n\nYour *Online Google Meet Interview* for the *${candidate.role || 'Job'}* position at *BrandSetu Digital* has been scheduled successfully. 💻✨\n\n📅 *Date & Time:* ${dateFormatted} at ${timeFormatted}\n🔗 *Platform:* Google Meet (Online)\n📌 *Important Note:* You will receive the Google Meet joining link here on WhatsApp 15 minutes before the interview starts.\n\nBest of luck! 👍\n- HR Team, BrandSetu Digital (+91 9329232025)`;
        } else {
          confirmMsg = isRescheduled
            ? `${salutationHi} 🔄\n\nBrandSetu Digital me *${candidate.role || 'Job'}* position ke liye aapka *Online Google Meet Interview* *reschedule* ho gaya hai. 💻✨\n\n📅 *Updated Date & Time:* ${dateFormatted} at ${timeFormatted}\n🔗 *Platform:* Google Meet (Online)\n📌 *Important Note:* Interview start hone se *15 minute pehle* aapko WhatsApp par Google Meet joining link send kar di jayegi.\n\nSee you then! 👍\n- HR Team, BrandSetu Digital (+91 9329232025)`
            : `${salutationHi} 🎉\n\nBrandSetu Digital me *${candidate.role || 'Job'}* position ke liye aapka *Online Google Meet Interview* schedule ho gaya hai. 💻✨\n\n📅 *Date & Time:* ${dateFormatted} at ${timeFormatted}\n🔗 *Platform:* Google Meet (Online)\n📌 *Important Note:* Interview start hone se *15 minute pehle* aapko isi WhatsApp chat par Google Meet joining link send kar di jayegi.\n\nAll the best! 👍\n- HR Team, BrandSetu Digital (+91 9329232025)`;
        }
      } else {
        // Standard In-Person Interview Invitation format (Indore Office)
        confirmMsg = `Dear ${candidateDisplayName},\n\n${isRescheduled ? 'Your interview at BrandSetu Digital has been rescheduled as requested.' : 'Congratulations! You have been shortlisted for the interview at BrandSetu Digital.'}\nWe are pleased to invite you for the next round of the selection process.\n\n📅 Date: ${dateFormatted}\n⏰ Time: ${timeFormatted}\n                  \n📍Google Maps Location: https://maps.app.goo.gl/M6kv6SPc4rKMwj887?g_st=ic\n\nBhawarkua main road orange business park floor 103 mc donald's building, Indore\n\nPlease make sure to reach on time.\nFor any assistance, feel free to contact us.\n\nLooking forward to meeting you.\n\nWarm regards,\nBrandSetu Digital`;
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
  const salutationEn = getCandidateSalutation(candidate, 'english');
  const salutationHi = getCandidateSalutation(candidate, 'hinglish');

  const reminderText = isEnglish
    ? `${salutationEn} 👋\n\nThank you for your interest in joining *BrandSetu Digital* for the *${candidate.role || 'Job'}* position. We noticed we haven't received your updated *Resume / Portfolio* yet. 📄\n\n👉 Please share your Resume (PDF) or Portfolio link here so we can proceed with scheduling your interview. 🚀\n\n- HR Team, BrandSetu Digital (+91 9329232025 / +91 9669765911)`
    : `${salutationHi} 👋\n\nBrandSetu Digital me *${candidate.role || 'Job'}* position ke liye aapke interest ke liye dhanyawad. Humein abhi tak aapka updated *Resume / Portfolio* receive nahi hua hai. 📄\n\n👉 Kripya apna Resume (PDF) ya Portfolio link yahan share karein taaki hum aapka interview schedule kar sakein. 🚀\n\n- HR Team, BrandSetu Digital (+91 9329232025 / +91 9669765911)`;

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

    const salutationEn = getCandidateSalutation(candidate, 'english');
    const salutationHi = getCandidateSalutation(candidate, 'hinglish');

    // 1. Send Reminder to Candidate (Strictly matched English / Hinglish)
    let candidateReminderMsg = '';
    if (isEnglish) {
      candidateReminderMsg = isOnline
        ? `${salutationEn} 🔔 *Interview Reminder*\n\nYour *Online Google Meet Interview* for *${candidate.role}* at *Brand Setu Digital* is scheduled today at *${formattedTime}*. 💻\n\n📌 *Joining Link:* You will receive the Google Meet link here on WhatsApp 15 minutes before the interview starts.\n\n👉 Are you ready and available for the interview? Please confirm. 👍\n\n📞 Help: +91 9329232025 / +91 9669765911\n- HR Team, Brand Setu Digital`
        : `${salutationEn} 🔔 *Interview Reminder*\n\nYour in-person interview for *${candidate.role}* at *Brand Setu Digital* is scheduled today at *${formattedTime}*.\n\n📍 *Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Indore (M.P.) - 452014\n\n👉 Are you on your way to our office for the interview? Please confirm. 👍\n\n📞 Help/Directions: +91 9329232025 / +91 9669765911\n- HR Team, Brand Setu Digital`;
    } else {
      candidateReminderMsg = isOnline
        ? `${salutationHi} 🔔 *Interview Reminder*\n\nAaj aapka *Brand Setu Digital* me *${candidate.role}* ke liye *Online Google Meet Interview* scheduled hai at *${formattedTime}*. 💻\n\n📌 *Joining Link:* Interview shuru hone se 15 minute pehle aapko isi WhatsApp chat par Google Meet link mil jayegi.\n\n👉 Kya aap interview ke liye ready aur available hain? Kripya confirm karein. 👍\n\n📞 Help: +91 9329232025 / +91 9669765911\n- HR Team, Brand Setu Digital`
        : `${salutationHi} 🔔 *Interview Reminder*\n\nAaj aapka *Brand Setu Digital* me *${candidate.role}* ke liye interview scheduled hai at *${formattedTime}*.\n\n📍 *Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Indore (M.P.) - 452014\n\n👉 Kya aap interview ke liye office aa rahe hain? Kripya confirm karein. 👍\n\n📞 Help/Directions: +91 9329232025 / +91 9669765911\n- HR Team, Brand Setu Digital`;
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
    if (!candidate.resumeReceived && !candidate.resumeReminderSent && candidate.status !== 'Not Interested' && candidate.status !== 'Closed' && candidate.createdAt) {
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
  generateExcelWorkbook,
  generateExcelBuffer,
  getFilteredCandidates,
  restoreFromBackup,
  trackCandidateFromMessage,
  trackOutgoingCampaignMessage,
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


