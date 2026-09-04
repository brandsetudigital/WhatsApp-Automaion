require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// AI Chatbot State & Knowledge Base
let aiConfig = {
  enabled: true,
  apiKey: process.env.GEMINI_API_KEY || '',
  provider: 'gemini',
  businessName: 'Brand Setu Digital - HR & Recruitment',
  businessDescription: 'Brand Setu Digital is hiring for 6 active roles: Video Editor, AI Video Expert, Graphic Designer, SEO & AEO Expert, Social Media Manager, and Digital Marketing Manager for our Indore office.',
  knowledgeBase: '',
  systemPrompt: ''
};

const AI_CONFIG_FILE = path.join(__dirname, '..', 'ai_config.json');

function loadAiConfig() {
  if (fs.existsSync(AI_CONFIG_FILE)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf8'));
      aiConfig = { ...aiConfig, ...fileData };
    } catch (err) {
      console.error('Error loading ai_config.json:', err);
    }
  }
}

function saveAiConfig() {
  try {
    fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(aiConfig, null, 2));
  } catch (err) {
    console.error('Error saving ai_config.json:', err);
  }
}

// Initial load
loadAiConfig();

function getAiConfig() {
  const maskedKey = aiConfig.apiKey
    ? `${aiConfig.apiKey.substring(0, 4)}...${aiConfig.apiKey.substring(aiConfig.apiKey.length - 4)}`
    : '';
  return {
    ...aiConfig,
    apiKeyMasked: maskedKey
  };
}

function updateAiConfig(updateData) {
  const { enabled, apiKey, provider, businessName, businessDescription, knowledgeBase, systemPrompt } = updateData;

  if (enabled !== undefined) aiConfig.enabled = !!enabled;
  if (apiKey !== undefined && apiKey !== '••••••••' && apiKey.trim() !== '') {
    aiConfig.apiKey = apiKey.trim();
  }
  if (provider) aiConfig.provider = provider;
  if (businessName) aiConfig.businessName = businessName;
  if (businessDescription) aiConfig.businessDescription = businessDescription;
  if (knowledgeBase) aiConfig.knowledgeBase = knowledgeBase;
  if (systemPrompt) aiConfig.systemPrompt = systemPrompt;

  saveAiConfig();
  return getAiConfig();
}

/**
 * Detect Language (Default to English unless Devanagari Hindi or explicit Hinglish phrases used)
 */
function detectLanguage(text) {
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hindi';
  }
  const clean = (text || '').toLowerCase().trim();
  const strongHinglishWords = [
    'kese', 'kaise', 'kaha', 'kahan', 'batao', 'bataye', 'batayein', 'hoga',
    'krte', 'karte', 'karna', 'chahiye', 'mera', 'meri', 'mere', 'aapse',
    'krna', 'bhi', 'kuchh', 'achha', 'accha', 'kitna', 'kitni', 'milega',
    'milegi', 'lagega', 'aa sakta hu', 'aa skta hu', 'dopahar', 'baje',
    'kya', 'hai', 'h', 'hum', 'aap', 'ji', 'theek', 'thik', 'bhejo', 'bheja',
    'aana', 'jana', 'kab', 'kis', 'parso', 'kal', 'nhi', 'nahi', 'mujhe'
  ];
  const words = clean.split(/[\s,?.!]+/);
  const countHinglish = words.filter(w => strongHinglishWords.includes(w)).length;

  if (countHinglish >= 1) {
    return 'hinglish';
  }

  return 'english';
}

/**
 * Call Gemini API with current active models
 */
async function callGeminiApi(promptText, apiKey, options = {}) {
  const candidateModels = [
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash'
  ];

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.65,
          maxOutputTokens: options.maxTokens ?? 400
        }
      };

      if (options.jsonMode) {
        payload.generationConfig.responseMimeType = 'application/json';
      }

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: options.timeout ?? 10000
      });

      const candidates = response.data?.candidates;
      if (candidates && candidates[0]?.content?.parts[0]?.text) {
        const text = candidates[0].content.parts[0].text.trim();
        return { text, model };
      }
    } catch (err) {
      const is429 = err.response?.status === 429;
      const errDetail = err.response?.data?.error?.message || err.message;
      console.warn(`⚠️ Gemini model [${model}] error: ${errDetail}`);
      if (is429) {
        // Quota exceeded: fail fast to instant fallback engine
        break;
      }
    }
  }
  return null;
}

function extractJsonFromString(str) {
  if (!str) return null;
  const cleaned = str.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {}
    }
  }
  return null;
}

function parseInterviewScheduleLocal(userMessage, candidate = null) {
  if (!userMessage) return null;
  const rawText = String(userMessage).trim();
  const text = rawText.toLowerCase();

  // 1. Filter out pure non-scheduling queries (salary, experience, role selection, general questions)
  if (text.includes('timing') || text.includes('salary') || text.includes('address') || text.includes('kaha') || text.includes('where') || text.includes('package') || text.includes('tool') || text.includes('skill') || text.includes('exp') || text.includes('year') || text.includes('portfolio') || text.includes('resume')) {
    // Only proceed if explicit scheduling verb is present
    if (!text.includes('aa sakta') && !text.includes('aa jaunga') && !text.includes('aunga') && !text.includes('aungi') && !text.includes('reschedule') && !text.includes('visit kar')) {
      return null;
    }
  }

  // 2. Detect Negation (e.g. "kal nahi aa sakta", "cannot come tomorrow", "not possible", "nahi ho payega", "not available")
  const negationPattern = /(?:nhi\s*a\s*s[a-z]*|nahi\s*aa\s*s[a-z]*|nahi\s*aa\s*p[a-z]*|nhi\s*aa\s*p[a-z]*|not\s*coming|can'?t\s*come|cannot\s*come|unable\s*to\s*come|not\s*possible|not\s*available|cancel|nahi\s*ho\s*payega|kal\s*nahi|kal\s*nhi|busy\s*hu|kisi\s*aur\s*din)/i;
  const hasNegation = negationPattern.test(text);

  // 3. Determine working text: if there's negation with reschedule clause
  let schedulingText = text;
  if (hasNegation) {
    const rescheduleMatch = text.match(/(?:reschedule|shift|instead|naya\s*time|dusre\s*din|phir|ab|parso|monday|tuesday|wednesday|thursday|friday|saturday)\s*(?:my\s*interview|to|for|ko)?\s*(.*)/i);
    if (rescheduleMatch && rescheduleMatch[1] && rescheduleMatch[1].trim().length > 2) {
      schedulingText = rescheduleMatch[0].trim();
    } else {
      const alternativeMatch = text.match(/(?:aaj|today|tomorrow|kal|monday|tuesday|wednesday|thursday|friday|saturday)\s*(?:ko)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?/i);
      if (alternativeMatch && !negationPattern.test(alternativeMatch[0])) {
        schedulingText = alternativeMatch[0];
      } else {
        return null; // Candidate said NO / Not available without alternative date
      }
    }
  }

  // 4. Check for Affirmative Confirmation (e.g. "ha", "haan", "yes", "ok", "done", "aa sakta hu", "theek hai", "sure")
  const affirmativePattern = /^(?:ha|haan|haa|yes|yep|yeah|ok|okay|sure|done|theek|thik|theek\s*hai|thik\s*h|thik\s*hai|aunga|aungi|aa\s*jaunga|aa\s*jaungi|aa\s*sakta\s*hu|aa\s*sakti\s*hu|chalega|confirm|yes\s*sir|ha\s*sir|ha\s*aa\s*jaunga|kal\s*aa\s*jaunga|kal\s*aa\s*sakta\s*hu|ha\s*kal|yes\s*tomorrow)(?:[\s,!.].*)?$/i;
  const isAffirmative = affirmativePattern.test(text);

  // 5. Must have day indicator OR explicit time keyword OR affirmative response when interview slot is pending
  const hasDayIndicator = /\b(tomorrow|kal|aaj|today|parso|parson|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(schedulingText);
  const hasExplicitTimeModifier = /(?:\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b|\b(?:dopahar|subah|shaam)\s*\d{1,2}\b)/i.test(schedulingText);

  if (!hasDayIndicator && !hasExplicitTimeModifier && !isAffirmative) {
    return null;
  }

  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);

  let targetDate = new Date(istNow);
  let dayOffset = 1; // Default to tomorrow for affirmative responses

  if (schedulingText.includes('day after tomorrow') || schedulingText.includes('parso') || schedulingText.includes('parson')) {
    dayOffset = 2;
  } else if (schedulingText.includes('tomorrow') || schedulingText.includes('kal') || isAffirmative) {
    dayOffset = 1;
    // If tomorrow is Sunday, roll over to Monday
    const tomorrowDay = (istNow.getUTCDay() + 1) % 7;
    if (tomorrowDay === 0) dayOffset = 2;
  } else if (schedulingText.includes('today') || schedulingText.includes('aaj')) {
    dayOffset = 0;
  } else {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = istNow.getUTCDay();
    for (let i = 0; i < days.length; i++) {
      if (schedulingText.includes(days[i])) {
        let diff = i - currentDay;
        if (diff <= 0) diff += 7;
        dayOffset = diff;
        break;
      }
    }
  }

  targetDate.setUTCDate(targetDate.getUTCDate() + dayOffset);

  // Default hour: 11:00 AM (between 10 AM - 12 PM morning slot)
  let hour = 11;
  let minute = 0;

  const timeMatch = schedulingText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?/i);
  if (timeMatch) {
    let rawHour = parseInt(timeMatch[1], 10);
    const rawMin = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const modifier = timeMatch[3] ? timeMatch[3].toLowerCase() : '';

    if (rawHour >= 1 && rawHour <= 12) {
      if (modifier === 'pm') {
        if (rawHour !== 12) rawHour += 12;
      } else if (modifier === 'am') {
        if (rawHour === 12) rawHour = 0;
      } else if (modifier === 'baje' || !modifier) {
        if (rawHour >= 1 && rawHour <= 6) {
          rawHour += 12;
        }
      }
    }

    if (rawHour >= 10 && rawHour <= 18) {
      hour = rawHour;
      minute = rawMin;
    }
  }

  targetDate.setUTCHours(hour, minute, 0, 0);

  const yyyy = targetDate.getUTCFullYear();
  const mm = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getUTCDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const min = String(minute).padStart(2, '0');

  const isoStr = `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`;

  const isOnlineMode = /(?:online|google\s*meet|meet|zoom|virtual|video\s*call|bahar|out\s*of\s*indore|not\s*in\s*indore)/i.test(text) || (candidate && candidate.interviewMode === 'online');

  return {
    isScheduling: true,
    proposedDateTimeIso: isoStr,
    interviewMode: isOnlineMode ? 'online' : 'in_person',
    readableFormattedTime: `${dd}/${mm}/${yyyy} at ${hour > 12 ? hour - 12 : hour}:${min} ${hour >= 12 ? 'PM' : 'AM'}`
  };
}

/**
 * Detect Interview Date/Time from candidate message (Hybrid: Fast Local + Gemini)
 */
async function parseInterviewScheduleWithGemini(userMessage, candidate = null) {
  const localParsed = parseInterviewScheduleLocal(userMessage, candidate);
  if (localParsed && localParsed.isScheduling) {
    return localParsed;
  }

  const negationPattern = /(?:nhi\s*a\s*s[a-z]*|nahi\s*aa\s*s[a-z]*|nahi\s*aa\s*p[a-z]*|nhi\s*aa\s*p[a-z]*|not\s*coming|can'?t\s*come|cannot\s*come|unable\s*to\s*come|not\s*possible|not\s*available|cancel|nahi\s*ho\s*payega|kal\s*nahi|kal\s*nhi)/i;
  if (negationPattern.test(userMessage) && !/(?:parso|monday|tuesday|wednesday|thursday|friday|saturday|\b\d{1,2}\s*(?:baje|am|pm)\b)/i.test(userMessage)) {
    return null; // Pure negation without alternative
  }

  // Fast pre-filter: Skip LLM call if message has no scheduling/time/affirmative keywords
  const scheduleKeywords = /(?:kal|tomorrow|today|aaj|parso|baje|am|pm|interview|schedule|reschedule|monday|tuesday|wednesday|thursday|friday|saturday|sunday|aunga|aungi|aa\s*raha|haan|yes|yep|sure|done|online|google\s*meet|\b(?:1[0-2]|[1-9])\s*(?:baje|am|pm|o'?clock)?\b)/i;
  if (!scheduleKeywords.test(userMessage)) {
    return null;
  }

  loadAiConfig();
  const apiKey = (aiConfig.apiKey && aiConfig.apiKey !== '••••••••' && aiConfig.apiKey.trim() !== '')
    ? aiConfig.apiKey.trim()
    : (process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '');

  if (!apiKey || apiKey.trim() === '') return null;

  const nowIso = new Date().toISOString();
  const prompt = `
You are an intelligent date & time parser for an HR hiring system in Indore, India (Timezone: Asia/Kolkata, UTC+5:30).
Current Date & Time: ${nowIso}

Context:
Candidate message: "${userMessage}"

Instructions:
1. Determine if candidate is proposing/confirming a specific date, day, or time when they CAN come for an in-person interview (e.g., "Tomorrow at 2 PM", "Monday 11 AM", "Kal 3 baje aa jaunga", "Today at 4 PM", "Reschedule to today 5 PM").
2. If candidate says they CANNOT come without proposing a new time, set isScheduling to false!
3. If YES, compute the target date-time in ISO-8601 string format with "+05:30" offset (e.g. "2026-08-21T14:00:00+05:30"). Office hours: 10:00 AM to 06:00 PM.
4. If NO, set isScheduling to false.

Return JSON strictly:
{
  "isScheduling": true,
  "proposedDateTimeIso": "YYYY-MM-DDTHH:mm:ss+05:30",
  "readableFormattedTime": "e.g., Friday, 21 Aug at 2:00 PM"
}
`;

  try {
    const result = await callGeminiApi(prompt, apiKey, { jsonMode: true, temperature: 0.1, timeout: 8000 });
    if (result && result.text) {
      const parsed = extractJsonFromString(result.text);
      if (parsed && parsed.isScheduling && parsed.proposedDateTimeIso) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error parsing interview schedule with Gemini:', err.message);
  }
  return null;
}

/**
 * Intelligent Fallback Engine (Runs if internet/API fails)
 */
function generateContextualFallbackResponse(candidate, userMessage, lang) {
  const text = (userMessage || '').toLowerCase().trim();
  const clean = text.replace(/[^\w\s]/g, '').trim();

  let candName = (candidate.name || '').trim();
  if (!candName || candName.toLowerCase() === 'candidate' || candName.toLowerCase() === 'customer') {
    candName = '';
  }
  const firstName = candName ? candName.split(' ')[0] : '';
  const greetingEn = firstName ? `Hello ${firstName}! 😊` : `Hello! 😊`;
  const greetingHi = firstName ? `Namaste ${firstName}! 🙏` : `Namaste! 🙏`;

  const isHinglish = (lang === 'hinglish' || lang === 'hindi');

  let interviewFormatted = '';
  if (candidate.interviewDateTime) {
    try {
      const d = new Date(candidate.interviewDateTime);
      interviewFormatted = d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      interviewFormatted = candidate.interviewDateTime;
    }
  }

  // 1. OTHER ROLE CHECK (Roles not in current 6 active openings e.g. Website Developer, Telecaller, Accountant, etc.)
  const otherRolePattern = /(?:web|website|developer|development|php|python|react|node|java|flutter|android|ios|content\s*writer|telecaller|caller|calling|sales|bpo|receptionist|accountant|data\s*entry)/i;
  const isExcludedRole = otherRolePattern.test(text) && !text.includes('seo') && !text.includes('aeo') && !text.includes('video') && !text.includes('editor') && !text.includes('graphic') && !text.includes('design') && !text.includes('social media') && !text.includes('digital marketing');

  if (isExcludedRole) {
    let mentionedRole = 'this role';
    if (text.includes('web') || text.includes('developer')) mentionedRole = 'Website Developer';
    else if (text.includes('content') || text.includes('writer')) mentionedRole = 'Content Writer';
    else if (text.includes('telecaller') || text.includes('caller')) mentionedRole = 'Telecaller';
    else if (text.includes('accountant')) mentionedRole = 'Accountant';

    if (isHinglish) {
      return `${greetingHi}\n\nFilhal Brand Setu Digital me in 6 active roles ke liye hiring chal rahi hai:\n🎬 1. Video Editor\n🤖 2. AI Video Expert\n🎨 3. Graphic Designer\n🔎 4. SEO & AEO Expert\n📱 5. Social Media Manager\n📢 6. Digital Marketing Manager\n\nAbhi hamare paas *${mentionedRole}* ke liye vacancy open nahi hai. Humne aapki details note kar li hain, future opening aane par contact karenge! 👍✨`;
    } else {
      return `${greetingEn}\n\nCurrently, Brand Setu Digital is actively hiring for these 6 positions:\n🎬 1. Video Editor\n🤖 2. AI Video Expert\n🎨 3. Graphic Designer\n🔎 4. SEO & AEO Expert\n📱 5. Social Media Manager\n📢 6. Digital Marketing Manager\n\nWe do not have active openings for *${mentionedRole}* at the moment. We have saved your profile on file for future opportunities! 👍✨`;
    }
  }

  // 2. OUT OF INDORE / ONLINE GOOGLE MEET INTERVIEW CHECK
  const outOfIndorePattern = /(?:indore\s*se\s*bahar|out\s*of\s*indore|not\s*in\s*indore|bahar\s*hu|bahar\s*rehta|bhopal|delhi|ujjain|dewas|gwaliar|gwalior|jabalpur|raipur|jaipur|pune|mumbai|other\s*city|dusre\s*shehar|online\s*interview|google\s*meet|virtual\s*interview|video\s*call\s*interview|online\s*meet|online\s*kar\s*lo|online\s*ho\s*skta|online\s*ho\s*sakta|online\s*de\s*sakta|online\s*le\s*lo)/i;
  if (outOfIndorePattern.test(text)) {
    candidate.interviewMode = 'online';
    if (isHinglish) {
      return `${greetingHi}\n\nKoi baat nahi! Agar aap filhal Indore se bahar hain, toh hum aapka *Online Google Meet Interview* conduct kar sakte hain. 💻✨\n\n👉 Kripya batayein aap kis din aur time par online interview ke liye available hain? (Monday to Saturday, 10:00 AM se 6:00 PM ke beech) 📅\n\n📌 *(Interview shuru hone se 15 minute pehle aapko WhatsApp par Google Meet joining link mil jayegi).* 👍`;
    } else {
      return `${greetingEn}\n\nNo problem at all! If you are currently outside Indore, we can conduct your interview online via *Google Meet*. 💻✨\n\n👉 Please share your preferred Date and Time when you are available for the online interview (Monday to Saturday, 10:00 AM – 6:00 PM). 📅\n\n📌 *(You will receive the Google Meet joining link on WhatsApp 15 minutes prior to the interview).* 👍`;
    }
  }

  // 3. NEGATION / CANNOT COME TOMORROW / RESCHEDULE REQUEST
  const unablePhrases = /(?:nhi\s*a\s*s[a-z]*|nahi\s*aa\s*s[a-z]*|nahi\s*aa\s*p[a-z]*|nhi\s*aa\s*p[a-z]*|not\s*coming|can'?t\s*come|cannot\s*come|unable\s*to\s*come|not\s*possible|not\s*available|cancel|nahi\s*ho\s*payega|kal\s*nahi|kal\s*nhi|busy\s*hu|busy|kisi\s*aur\s*din|nahi|nhi)/i;
  if (unablePhrases.test(text) && !text.includes('ha') && !text.includes('yes')) {
    if (isHinglish) {
      return `${greetingHi}\n\nKoi baat nahi! Aap apni suvidha ke anusaar preferred Date aur Time bata dijiye (Monday to Saturday, 10:00 AM se 6:00 PM ke beech) kab aap interview ke liye aa sakte hain? 📅`;
    } else {
      return `${greetingEn}\n\nNo problem at all! Please share your preferred Date and Time (Monday to Saturday, between 10:00 AM and 6:00 PM) when you would be available to visit for your in-person interview. 📅`;
    }
  }

  // 4. FAQ: SALARY / STIPEND / PAID INTERNSHIP QUESTIONS
  if (text.includes('salary') || text.includes('package') || text.includes('kitna milega') || text.includes('ctc') || text.includes('stipend') || text.includes('paise') || text.includes('per month') || text.includes('pay') || text.includes('internship') || text.includes('certificate')) {
    if (isHinglish) {
      return `${greetingHi}\n\n💰 *Internship & Salary Details:*\nHamare yahan Paid Internship (3-6 Months) & Full-Time opportunities dono hain. Deserving candidates ko performance ke base par stipend/salary, Certificate of Completion, expert mentorship aur Full-Time placement offer milta hai. 🤝\n\nFinal stipend/salary practical assessment aur in-person interview ke baad decide hoti hai.\n\n${candidate.interviewDateTime ? `Aapka interview already scheduled hai for: *${interviewFormatted}*.` : (candidate.resumeReceived ? '👉 Kya aap kal morning me *10:00 AM se 12:00 PM* ke beech hamare Indore office (*103 Orange Business Park, Bhawarkua*) interview ke liye aa sakte hain?' : (candidate.role && candidate.role !== 'General Applicant' ? 'Kripya apna updated Resume / Portfolio share karein taaki hum interview process aage badha sakein. 📄' : '👉 Aap kis role (1 to 6) ke liye apply karna chahte hain?'))}`;
    } else {
      return `${greetingEn}\n\n💰 *Internship & Compensation Details:*\nWe offer Paid Internships (3-6 Months) as well as Full-Time roles. Deserving candidates receive a performance-based stipend/salary, Certificate of Completion, industry mentorship, and full-time placement opportunities. 🤝\n\nFinal compensation is negotiable and decided based on your practical skills and in-person interview.\n\n${candidate.interviewDateTime ? `Your interview is confirmed for: *${interviewFormatted}*.` : (candidate.resumeReceived ? '👉 Are you available to visit our Indore office tomorrow morning between *10:00 AM and 12:00 PM* for your interview?' : (candidate.role && candidate.role !== 'General Applicant' ? 'Please share your updated Resume or Portfolio link so we can schedule your interview. 📄' : '👉 Which position (1 to 6) would you like to apply for?'))}`;
    }
  }

  // 5. FAQ: OFFICE ADDRESS / LOCATION
  if (text.includes('location') || text.includes('address') || text.includes('kahan') || text.includes('kaha') || text.includes('where') || text.includes('office') || text.includes('bhawarkua') || text.includes('apple hospital')) {
    if (isHinglish) {
      return `${greetingHi}\n\n📍 *Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n⏰ *Office Timings:* Mon–Sat (10:00 AM – 7:00 PM)\n📞 *Contact:* +91 9329232025`;
    } else {
      return `${greetingEn}\n\n📍 *Office Location:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n⏰ *Timings:* Monday to Saturday (10:00 AM – 7:00 PM)\n📞 *Contact:* +91 9329232025`;
    }
  }

  // 6. FAQ: WORK FROM HOME / REMOTE
  if (text.includes('wfh') || text.includes('work from home') || text.includes('remote') || text.includes('ghar se')) {
    if (isHinglish) {
      return `${greetingHi}\n\n🏢 Yeh Onsite *In-Office* role hai hamare Indore office (103 Orange Business Park, Bhawarkua) ke liye. Remote ya Work-From-Home option available nahi hai.\n\nAgar aap Indore office visit kar sakte hain to kripya apna Resume share karein. 👍`;
    } else {
      return `${greetingEn}\n\n🏢 This is an Onsite *In-Office* position at our Indore office (103 Orange Business Park, Bhawarkua). We currently do not offer remote/work-from-home options.\n\nIf you are available for an in-office role in Indore, please share your resume or portfolio to proceed. 👍`;
    }
  }

  // ── STEP 1: CANDIDATE HAS NOT SELECTED A ROLE YET (Or requested fresh start) ──
  if (!candidate.role || candidate.role === 'General Applicant') {
    if (isHinglish) {
      return `${greetingHi}\nBrand Setu Digital me aapka swagat hai! 🎉\n\nHum Indore office ke liye in 6 active roles par hiring kar rahe hain:\n1️⃣ 🎬 *Video Editor*\n2️⃣ 🤖 *AI Video Expert*\n3️⃣ 🎨 *Graphic Designer*\n4️⃣ 🔎 *SEO & AEO Expert*\n5️⃣ 📱 *Social Media Manager*\n6️⃣ 📢 *Digital Marketing Manager*\n\n👉 Aap **kis position/role** ke liye apply karna chahte hain? (1 to 6 number ya role ka naam likhein) 📝`;
    } else {
      return `${greetingEn}\nWelcome to Brand Setu Digital! 🎉\n\nWe are actively hiring for these 6 positions at our Indore office:\n1️⃣ 🎬 *Video Editor*\n2️⃣ 🤖 *AI Video Expert*\n3️⃣ 🎨 *Graphic Designer*\n4️⃣ 🔎 *SEO & AEO Expert*\n5️⃣ 📱 *Social Media Manager*\n6️⃣ 📢 *Digital Marketing Manager*\n\n👉 Which **position/role** would you like to apply for? (Please reply with number 1 to 6 or the role name) 📝`;
    }
  }

  // ── STEP 2: ROLE IS SELECTED, BUT EXPERIENCE / FRESHER STATUS NOT PROVIDED YET ──
  if (!candidate.experience || candidate.experience === '') {
    if (isHinglish) {
      return `${greetingHi}\nBahut badiya! Aapne *${candidate.role}* select kiya hai. 👍\n\nKripya batayein:\n1️⃣ Aap *Fresher (Paid Internship)* ke liye apply kar rahe hain ya *Experienced (Full-Time Role)* ke liye?\n2️⃣ Agar experienced hain, to aapko kitne time (months/years) ka experience hai? 💼`;
    } else {
      return `${greetingEn}\nGreat! You have selected *${candidate.role}*. 👍\n\nPlease let us know:\n1️⃣ Are you applying as a *Fresher (Paid Internship)* or *Experienced (Full-Time Role)*?\n2️⃣ If experienced, how many months/years of experience do you have? 💼`;
    }
  }

  // ── STEP 3: EXPERIENCE PROVIDED, BUT RESUME / PORTFOLIO PENDING ──
  if (!candidate.resumeReceived) {
    if (candidate.role === 'AI Video Expert') {
      return isHinglish
        ? `${greetingHi}\nAwesome! 🤖 Kripya apna updated *Resume (PDF)* aur AI video tools (Runway, Midjourney, Kling, Pika, etc.) se banaye hue samples ka *Google Drive link* yahan share karein. 📄🎥`
        : `${greetingEn}\nAwesome! 🤖 Please share your updated *Resume (PDF)* and your AI video work samples / Google Drive link here. 📄🎥`;
    } else if (candidate.role === 'Graphic Designer') {
      return isHinglish
        ? `${greetingHi}\nPerfect! 🎨 Kripya apna updated *Resume (PDF)* aur *Design Portfolio link (Behance / Drive / Figma)* yahan share karein. 📄🎨`
        : `${greetingEn}\nPerfect! 🎨 Please share your updated *Resume (PDF)* and your *Design Portfolio (Behance / Drive / Figma link)* here. 📄🎨`;
    } else if (candidate.role === 'SEO & AEO Expert') {
      return isHinglish
        ? `${greetingHi}\nGreat! 🔎 Kripya apna updated *Resume (PDF)* aur live SEO rankings / case studies details yahan share karein. 📄📊`
        : `${greetingEn}\nGreat! 🔎 Please share your updated *Resume (PDF)* and your live SEO rankings / case studies proof here. 📄📊`;
    } else if (candidate.role === 'Social Media Manager') {
      return isHinglish
        ? `${greetingHi}\nSuper! 📱 Kripya apna updated *Resume (PDF)* aur past managed social media profiles / growth proof share karein. 📄🚀`
        : `${greetingEn}\nSuper! 📱 Please share your updated *Resume (PDF)* and your past managed social media profiles / growth proof here. 📄🚀`;
    } else if (candidate.role === 'Digital Marketing Manager') {
      return isHinglish
        ? `${greetingHi}\nExcellent! 📢 Kripya apna updated *Resume (PDF)* aur Ad campaign / ROAS case studies yahan share karein. 📄💼`
        : `${greetingEn}\nExcellent! 📢 Please share your updated *Resume (PDF)* and your Ad campaign / ROAS case studies here. 📄💼`;
    } else {
      return isHinglish
        ? `${greetingHi}\nBahut badiya! 🎬 Kripya apna updated *Resume (PDF)* aur Video Editing ka *Portfolio / Google Drive link* yahan share karein taaki hum aapka in-person practical interview schedule kar sakein. 📄🎥`
        : `${greetingEn}\nGreat! 🎬 Please share your updated *Resume (PDF)* and your Video Portfolio / Google Drive link here so we can schedule your interview. 📄🎥`;
    }
  }

  // ── STEP 4: RESUME / PORTFOLIO RECEIVED, PROPOSE TOMORROW MORNING 10 AM - 12 PM SLOT ──
  if (candidate.resumeReceived && !candidate.interviewDateTime) {
    if (isHinglish) {
      return `${greetingHi}\nAapka Resume / Portfolio receive ho gaya hai, shukriya! 📄✨\n\n👉 Kya aap kal morning me *10:00 AM se 12:00 PM* ke beech hamare Indore office (*103 Orange Business Park, Bhawarkua*) in-person interview ke liye aa sakte hain? 🏢\n\nKripya confirm karein (Haan / Nahi ya apna suitable time batayein). 👍`;
    } else {
      return `${greetingEn}\nThank you for sharing your resume/portfolio! 📄✨\n\n👉 Are you available to visit our Indore office (*103 Orange Business Park, Bhawarkua*) for an in-person interview tomorrow morning between *10:00 AM and 12:00 PM*? 🏢\n\nPlease confirm (Yes / No or share your preferred time). 👍`;
    }
  }

  // ── STEP 5: INTERVIEW ALREADY CONFIRMED ──
  if (candidate.interviewDateTime) {
    const isOnline = candidate.interviewMode === 'online';
    if (isHinglish) {
      return isOnline
        ? `${greetingHi}\nAapka Online Google Meet interview already confirmed hai for *${interviewFormatted}*. Interview start hone se *15 minute pehle* aapko isi chat par Google Meet link share kar di jayegi! 💻✨`
        : `${greetingHi}\nAapka interview already confirmed hai for *${interviewFormatted}* at 103 Orange Business Park, Bhawarkua, Indore. Hum aapse milne ke liye eager hain! 😊📍`;
    } else {
      return isOnline
        ? `${greetingEn}\nYour Online Google Meet interview is confirmed for *${interviewFormatted}*. You will receive the joining link on WhatsApp 15 minutes prior to the interview! 💻✨`
        : `${greetingEn}\nYour interview is confirmed for *${interviewFormatted}* at 103 Orange Business Park, Bhawarkua, Indore. We look forward to meeting you! 😊📍`;
    }
  }
}

function cleanAiResponseText(rawText) {
  if (!rawText) return '';
  let text = rawText.trim();
  text = text.replace(/^```(?:markdown|json|text)?\s*/i, '').replace(/```\s*$/i, '').trim();
  text = text.replace(/^(?:Direct\s*WhatsApp\s*Message|HR\s*Assistant\s*Reply|Reply):\s*/i, '').trim();
  return text.trim();
}

/**
 * Generate Dynamic AI Response for Hiring Candidate Conversation
 */
async function generateHiringAIResponse(candidate, userMessage, messageData = {}) {
  loadAiConfig();

  const rawKey = (aiConfig.apiKey && aiConfig.apiKey !== '••••••••' && aiConfig.apiKey.trim() !== '')
    ? aiConfig.apiKey.trim()
    : (process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '');

  const lang = detectLanguage(userMessage);

  // Candidate Name
  let candName = (candidate.name || '').trim();
  if (!candName || candName.toLowerCase() === 'candidate' || candName.toLowerCase() === 'customer') {
    candName = (messageData.customerName && messageData.customerName !== 'Customer') ? messageData.customerName : 'Candidate';
  }

  const candidateSummary = {
    name: candName,
    role: candidate.role && candidate.role !== 'General Applicant' ? candidate.role : 'None (Pending selection)',
    experience: candidate.experience || 'None (Pending)',
    city: candidate.city || 'Indore',
    resumeReceived: candidate.resumeReceived ? 'Yes (Received)' : 'No (Pending)',
    portfolio: candidate.portfolio || 'None',
    status: candidate.status || 'Applied',
    interviewScheduled: candidate.interviewDateTime ? `Confirmed for ${candidate.interviewDateTime}` : 'Not yet scheduled',
    messageType: messageData.messageType || 'text'
  };

  const historyLines = (candidate.chatHistory || []).slice(-8).map(h => {
    return `${h.role === 'user' ? 'Candidate' : 'HR Assistant'}: ${h.text}`;
  }).join('\n');

  const systemInstructions = (aiConfig.systemPrompt && aiConfig.systemPrompt.trim()) || `
You are the professional, friendly HR & Recruitment Coordinator for Brand Setu Digital (Indore).
  `.trim();

  const prompt = `
${systemInstructions}

COMPANY INFORMATION & KNOWLEDGE BASE:
${aiConfig.knowledgeBase}

CANDIDATE PROFILE:
- Name: ${candidateSummary.name}
- Current Role Applied: ${candidateSummary.role}
- Experience / Status: ${candidateSummary.experience}
- Resume / Portfolio: ${candidateSummary.resumeReceived}
- Interview Status: ${candidateSummary.interviewScheduled}

RECENT CONVERSATION HISTORY:
${historyLines ? historyLines : '(Start of chat)'}

LATEST CANDIDATE MESSAGE:
"${userMessage}"

STRICT STEP-BY-STEP RECRUITMENT FUNNEL INSTRUCTIONS:
Follow these 4 sequential qualification steps strictly:

👉 STEP 1 (If candidate has NOT chosen a role yet):
Greet candidate by name and present the 6 active openings (1. Video Editor, 2. AI Video Expert, 3. Graphic Designer, 4. SEO & AEO Expert, 5. Social Media Manager, 6. Digital Marketing Manager). Ask which position (1 to 6) they want to apply for.

👉 STEP 2 (If role is chosen, but Experience / Fresher status is not known yet):
Acknowledge the chosen role and ask:
1. Are they applying as a Fresher (Paid Internship) or Experienced (Full-Time)?
2. If experienced, how many months/years of experience do they have?

👉 STEP 3 (If role & experience are known, but Resume / Portfolio is pending):
Ask for their updated Resume (PDF) + role-specific work samples / portfolio / Google Drive link based on the job requirements.

👉 STEP 4 (If Resume / Portfolio has been received, but interview not scheduled yet):
1. Propose tomorrow morning slot: Ask "Kya aap kal morning me 10:00 AM se 12:00 PM ke beech hamare Indore office (103 Orange Business Park, Bhawarkua) interview ke liye aa sakte hain?"
2. If candidate says NO / Cannot come / Not available / Busy: Reply politely: "Koi baat nahi! Aap apni suvidha ke anusaar preferred Date aur Time bata dijiye (Monday to Saturday, 10:00 AM se 6:00 PM ke beech) kab aap interview ke liye aa sakte hain? 📅"

RULES:
- If candidate asks about Stipend / Salary: Clarify that we offer Paid Internships (3-6 Months) & Full-Time roles with negotiable stipend/salary decided after practical assessment.
- If candidate asks about Location / WFH: Explain that this is strictly Onsite In-Office at 103 Orange Business Park, Bhawarkua, Indore.
- If candidate writes in Hindi/Hinglish, reply in natural Hinglish. If in English, reply in crisp English.
- OUTPUT ONLY the direct WhatsApp reply. No thinking, no extra notes.

Direct WhatsApp Message:
`;

  // 1. Call Gemini AI with active modern models
  if (rawKey && rawKey.trim() !== '') {
    try {
      const result = await callGeminiApi(prompt, rawKey, { temperature: 0.6, maxTokens: 350 });
      if (result && result.text) {
        const cleanedText = cleanAiResponseText(result.text);
        if (cleanedText.length > 5) {
          console.log(`✨ [Gemini AI (${result.model})] Generated response for ${candidateSummary.name} (+${candidate.phone})`);
          return cleanedText;
        }
      }
    } catch (err) {
      console.warn('Gemini API call error:', err.message);
    }
  }

  // 2. Intelligent Multi-Intent Contextual Fallback
  console.log(`🧠 [Smart Context Engine] Generating personalized response for ${candidateSummary.name}...`);
  return generateContextualFallbackResponse(candidate, userMessage, lang);
}

/**
 * Generic AI Response Generator for test messages or non-candidate chats
 */
async function generateAIResponse(userMessage, context = '') {
  loadAiConfig();

  const rawKey = (aiConfig.apiKey && aiConfig.apiKey !== '••••••••' && aiConfig.apiKey.trim() !== '')
    ? aiConfig.apiKey.trim()
    : (process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '');

  const lang = detectLanguage(userMessage);

  const systemInstructions = (aiConfig.systemPrompt && aiConfig.systemPrompt.trim()) || `
You are the professional, friendly HR & Recruitment Coordinator for BrandSetu Digital (Indore).
  `.trim();

  const prompt = `
${systemInstructions}

COMPANY INFORMATION & KNOWLEDGE BASE:
${aiConfig.knowledgeBase}

CRITICAL RULES:
1. Sound polite, warm, and professional.
2. If the user asks in Hindi/Hinglish, reply in natural Hinglish. If in English, reply in crisp English.
3. Keep it brief (2 to 4 lines), clear, and structured with clean emojis.
4. Address candidate naturally without appending "ji".

${context ? `CONTEXT:\n${context}\n` : ''}

USER MESSAGE:
"${userMessage}"

Reply directly as HR Assistant:
`;

  if (rawKey && rawKey.trim() !== '') {
    try {
      const result = await callGeminiApi(prompt, rawKey, { temperature: 0.65, maxTokens: 400 });
      if (result && result.text) {
        return result.text;
      }
    } catch (err) {
      console.warn('Gemini API call error in generateAIResponse:', err.message);
    }
  }

  return generateContextualFallbackResponse({ name: 'Candidate' }, userMessage, lang);
}

module.exports = {
  getAiConfig,
  updateAiConfig,
  generateHiringAIResponse,
  generateAIResponse,
  parseInterviewScheduleWithGemini,
  parseInterviewScheduleLocal,
  detectLanguage
};
