require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// AI Chatbot State & Knowledge Base
let aiConfig = {
  enabled: true,
  apiKey: process.env.GEMINI_API_KEY || '',
  provider: 'gemini',
  businessName: 'BrandSetu Digital - HR & Recruitment',
  businessDescription: 'BrandSetu Digital is hiring talented professionals for SEO Expert and Video Editor roles for our Indore office.',
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
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest'
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
        timeout: options.timeout ?? 3500
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
        // Quota exceeded: fail fast to instant fallback engine without wasting time on subsequent models
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

function parseInterviewScheduleLocal(userMessage) {
  if (!userMessage) return null;
  const rawText = String(userMessage).trim();
  const text = rawText.toLowerCase();

  // 1. Check for general questions that shouldn't trigger automatic scheduling
  if (text.includes('timing') || text.includes('salary') || text.includes('address') || text.includes('kaha') || text.includes('where') || text.includes('package') || text.includes('tool') || text.includes('skill')) {
    return null;
  }

  // 2. Detect Negation (e.g. "kal nahi aa sakta", "cannot come tomorrow", "sry i not coming", "cancel")
  const negationPattern = /(?:nhi\s*a\s*s[a-z]*|nahi\s*aa\s*s[a-z]*|nahi\s*aa\s*p[a-z]*|nhi\s*aa\s*p[a-z]*|not\s*coming|can'?t\s*come|cannot\s*come|unable\s*to\s*come|cancel|nahi\s*ho\s*payega)/i;
  const hasNegation = negationPattern.test(text);

  // 3. Determine working text: if there's negation with reschedule clause (e.g. "not coming tomorrow, reschedule today 5 pm")
  let schedulingText = text;
  if (hasNegation) {
    const rescheduleMatch = text.match(/(?:reschedule|shift|instead|naya\s*time|dusre\s*din|phir|ab)\s*(?:my\s*interview|to|for|ko)?\s*(.*)/i);
    if (rescheduleMatch && rescheduleMatch[1] && rescheduleMatch[1].trim().length > 2) {
      schedulingText = rescheduleMatch[1].trim();
    } else {
      const alternativeMatch = text.match(/(?:aaj|today|tomorrow|kal|monday|tuesday|wednesday|thursday|friday|saturday)\s*(?:ko)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?/i);
      if (alternativeMatch && !negationPattern.test(alternativeMatch[0])) {
        schedulingText = alternativeMatch[0];
      } else {
        return null;
      }
    }
  }

  // 4. Must have time or day indicator
  const hasTimeIndicator = /(?:\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje|o'clock)?\b|\btomorrow\b|\bkal\b|\baaj\b|\btoday\b|\bmonday\b|\btuesday\b|\bwednesday\b|\bthursday\b|\bfriday\b|\bsaturday\b)/i.test(schedulingText);
  if (!hasTimeIndicator) return null;

  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);

  let targetDate = new Date(istNow);
  let dayOffset = 0;

  if (schedulingText.includes('day after tomorrow') || schedulingText.includes('parso') || schedulingText.includes('parson')) {
    dayOffset = 2;
  } else if (schedulingText.includes('tomorrow') || schedulingText.includes('kal')) {
    dayOffset = 1;
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

  return {
    isScheduling: true,
    proposedDateTimeIso: isoStr,
    readableFormattedTime: `${dd}/${mm}/${yyyy} at ${hour > 12 ? hour - 12 : hour}:${min} ${hour >= 12 ? 'PM' : 'AM'}`
  };
}

/**
 * Detect Interview Date/Time from candidate message (Hybrid: Fast Local + Gemini)
 */
async function parseInterviewScheduleWithGemini(userMessage, candidate = null) {
  const localParsed = parseInterviewScheduleLocal(userMessage);
  if (localParsed && localParsed.isScheduling) {
    return localParsed;
  }

  const negationPattern = /(?:nhi\s*a\s*s[a-z]*|nahi\s*aa\s*s[a-z]*|nahi\s*aa\s*p[a-z]*|nhi\s*aa\s*p[a-z]*|not\s*coming|can'?t\s*come|cannot\s*come|unable\s*to\s*come|cancel|nahi\s*ho\s*payega)/i;
  if (negationPattern.test(userMessage)) {
    return null;
  }

  // Fast pre-filter: Skip LLM call if message has no scheduling/time keywords
  const scheduleKeywords = /(?:kal|tomorrow|today|aaj|parso|baje|am|pm|interview|schedule|reschedule|monday|tuesday|wednesday|thursday|friday|saturday|sunday|aunga|aungi|aa\s*raha|\b(?:1[0-2]|[1-9])\s*(?:baje|am|pm|o'?clock)?\b)/i;
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

  // 1. OTHER ROLE CHECK (e.g. Website Developer, Graphic Designer, Content Writer, etc.)
  const otherRolePattern = /(?:web|website|developer|development|php|python|react|node|java|flutter|android|ios|graphic|designer|ui\s*\/?\s*ux|content|writer|telecaller|caller|calling|sales|bpo|receptionist|accountant|marketing|digital\s*marketing)/i;
  const isOtherRole = otherRolePattern.test(text) && !text.includes('seo') && !text.includes('video') && !text.includes('editor');

  if (isOtherRole) {
    let mentionedRole = 'this role';
    if (text.includes('web') || text.includes('developer')) mentionedRole = 'Website Developer';
    else if (text.includes('graphic') || text.includes('designer')) mentionedRole = 'Graphic Designer';
    else if (text.includes('content') || text.includes('writer')) mentionedRole = 'Content Writer';
    else if (text.includes('telecaller') || text.includes('caller')) mentionedRole = 'Telecaller';
    else if (text.includes('accountant')) mentionedRole = 'Accountant';

    if (isHinglish) {
      return `${greetingHi}\n\nFilhal BrandSetu Digital me sirf 1️⃣ *SEO Expert* aur 2️⃣ *Video Editor* (In-Office, Indore) ke liye hiring chal rahi hai.\n\nAbhi hamare paas *${mentionedRole}* ke liye vacancy open nahi hai. Humne aapki profile note kar li hai, future me vacancy aane par hum aapse zaroor contact karenge. 👍✨`;
    } else {
      return `${greetingEn}\n\nCurrently, BrandSetu Digital is actively hiring ONLY for:\n1️⃣ *SEO Expert*\n2️⃣ *Video Editor* (In-Office, Indore)\n\nWe do not have active openings for *${mentionedRole}* at the moment. We have saved your details on file and will reach out to you if a relevant position opens up in the future! 👍✨`;
    }
  }

  // 2. RESUME / PORTFOLIO SUBMISSION DETECTED (Right now in message)
  const isDirectResumeInMessage = (
    text.endsWith('.pdf') ||
    text.endsWith('.docx') ||
    text.endsWith('.doc') ||
    text.includes('.pdf') ||
    text.includes('.docx') ||
    text.includes('.doc') ||
    text.includes('drive.google.com') ||
    text.includes('docs.google.com') ||
    text.includes('behance.net') ||
    text.includes('github.com') ||
    text.includes('bhej diya') ||
    text.includes('share kar diya') ||
    text.includes('sent') ||
    text.includes('resume attached') ||
    text.includes('attached resume')
  );

  if (isDirectResumeInMessage) {
    if (!candidate.interviewDateTime) {
      if (isHinglish) {
        return `${greetingHi}\n\nAapka Resume / Portfolio receive ho gaya hai, shukriya! 📄✨\n\nAap in-person practical interview ke liye hamare Indore office (103 Orange Business Park, Bhawarkua) kis din aur time visit karna chahenge? (Monday to Saturday, 10:00 AM se 6:00 PM ke beech) 📅`;
      } else {
        return `${greetingEn}\n\nThank you for sharing your resume/portfolio! 📄✨\n\nWhen would you like to visit our Indore office (103 Orange Business Park, Bhawarkua) for an in-person interview? Please share your preferred date and time (Monday to Saturday, 10:00 AM – 6:00 PM). 📅`;
      }
    }
  }

  // 3. CANDIDATE RESUME IS ALREADY ON FILE (Ask for interview date/time directly)
  if (candidate.resumeReceived && !candidate.interviewDateTime) {
    if (isHinglish) {
      return `${greetingHi}\n\nAapka resume hamare paas already saved hai! 📄✨\n\nAap in-person interview ke liye hamare Indore office (Bhawarkua) kis din aur time visit kar sakte hain? (Monday to Saturday, 10:00 AM – 6:00 PM) 📅`;
    } else {
      return `${greetingEn}\n\nYour resume is already received and saved on file! 📄✨\n\nWhen would you like to visit our Indore office for your in-person interview? Please share your preferred date and time (Monday to Saturday, 10:00 AM – 6:00 PM). 📅`;
    }
  }

  // 4. TARGET ROLE SELECTION (SEO Expert / Video Editor)
  const isSeo = text.includes('seo') || text.includes('search engine') || text.includes('ranking');
  const isVideo = text.includes('video') || text.includes('editor') || text.includes('editing') || text.includes('reels');

  if (isSeo || isVideo) {
    const roleName = isVideo ? 'Video Editor' : 'SEO Expert';
    if (isHinglish) {
      return `${greetingHi}\n\nBrandSetu Digital me *${roleName}* post ke liye apply karne ke liye shukriya! 😊\n\nKripya apna updated *Resume (PDF)* ${roleName === 'Video Editor' ? 'ya Video Portfolio/Drive link ' : ''}yahan share karein taaki hum aapka in-person interview schedule kar sakein. 📄✨`;
    } else {
      return `${greetingEn}\n\nThank you for applying for the *${roleName}* position at BrandSetu Digital! 😊\n\nPlease share your updated *Resume (PDF)* ${roleName === 'Video Editor' ? 'or Video Portfolio/Drive link ' : ''}here so we can schedule your in-person interview at our Indore office. 📄💼`;
    }
  }

  // 4. SALARY / PACKAGE / EARNINGS QUESTION
  if (text.includes('salary') || text.includes('package') || text.includes('kitna milega') || text.includes('ctc') || text.includes('stipend') || text.includes('paise') || text.includes('per month') || text.includes('pay')) {
    if (isHinglish) {
      return `${greetingHi}\n\n💰 *Salary Details:*\nHamare yahan salary fixed nahi hai. Salary puri tarah negotiable hai aur aapke *skills, practical test, experience aur in-person interview performance* ke basis par decide hoti hai. 🤝\n\n${candidate.interviewDateTime ? `Aapka interview already scheduled hai for: *${interviewFormatted}*.` : (candidate.resumeReceived ? 'Aap in-person interview ke liye kab visit kar sakte hain? (Mon-Sat, 10 AM - 6 PM)' : 'Kripya apna updated Resume / Portfolio share karein taaki hum interview process aage badha sakein. 📄')}`;
    } else {
      return `${greetingEn}\n\n💰 *Salary Details:*\nSalary is not fixed and is completely negotiable based on your *in-person interview performance, practical skills, and experience*. 🤝\n\n${candidate.interviewDateTime ? `Your interview is confirmed for: *${interviewFormatted}*.` : (candidate.resumeReceived ? 'When would you like to schedule your in-person interview? (Mon-Sat, 10 AM - 6 PM)' : 'Please share your updated Resume or Portfolio link so we can schedule your interview. 📄')}`;
    }
  }

  // 5. OFFICE ADDRESS / LOCATION QUESTION
  if (text.includes('location') || text.includes('address') || text.includes('kahan') || text.includes('kaha') || text.includes('where') || text.includes('office') || text.includes('bhawarkua') || text.includes('apple hospital')) {
    if (isHinglish) {
      return `${greetingHi}\n\n📍 *Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n⏰ *Office Timings:* Mon–Sat (10:00 AM – 7:00 PM)\n📞 *Contact:* +91 9329232025`;
    } else {
      return `${greetingEn}\n\n📍 *Office Location:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n⏰ *Timings:* Monday to Saturday (10:00 AM – 7:00 PM)\n📞 *Contact:* +91 9329232025`;
    }
  }

  // 6. RESCHEDULE REQUEST / INABILITY TO COME
  const unablePhrases = /(?:nhi\s*a\s*s[a-z]*|nahi\s*aa\s*s[a-z]*|nahi\s*aa\s*p[a-z]*|nhi\s*aa\s*p[a-z]*|not\s*coming|can'?t\s*come|cannot\s*come|unable\s*to\s*come|cancel|reschedule|postpone)/i;
  if (unablePhrases.test(text)) {
    if (isHinglish) {
      return `${greetingHi}\n\nKoi baat nahi! Aap kis naye din ya time par hamare Indore office visit karna chahenge? (Monday to Saturday, 10:00 AM se 6:00 PM ke beech) 📅\n\nKripya apna preferred date aur time batayein, hum aapka interview reschedule kar denge. 👍`;
    } else {
      return `${greetingEn}\n\nNo problem at all! When would you like to reschedule your in-person interview? (Monday to Saturday, between 10:00 AM and 6:00 PM) 📅\n\nPlease share your preferred date and time, and we will update your schedule. 👍`;
    }
  }

  // 7. OFFICE TIMINGS / WORKING HOURS
  if (text.includes('timing') || text.includes('working hour') || text.includes('hours') || text.includes('sunday') || text.includes('kab aana') || text.includes('time')) {
    if (isHinglish) {
      return `${greetingHi}\n\n⏰ Hamare office timings Monday to Saturday subah 10:00 AM se shaam 7:00 PM tak hain (Sunday closed).\n\nInterview slots subah 10:00 AM se shaam 6:00 PM ke beech available hain. Aap kis din aur time visit karna chahenge?`;
    } else {
      return `${greetingEn}\n\n⏰ Our office timings are Monday to Saturday, 10:00 AM to 7:00 PM (Sunday is off).\n\nIn-person interview slots are open from 10:00 AM to 6:00 PM. Please let us know what time works best for you! 💼`;
    }
  }

  // 8. WORK FROM HOME / REMOTE
  if (text.includes('wfh') || text.includes('work from home') || text.includes('remote') || text.includes('online') || text.includes('ghar se')) {
    if (isHinglish) {
      return `${greetingHi}\n\n🏢 Yeh full-time *In-Office* role hai hamare Indore office (Bhawarkua) ke liye. Remote ya Work-From-Home option available nahi hai.\n\nAgar aap Indore office visit kar sakte hain to kripya apna Resume share karein. 👍`;
    } else {
      return `${greetingEn}\n\n🏢 This is a full-time *In-Office* position at our Indore office (Bhawarkua). We currently do not offer remote/work-from-home options.\n\nIf you are available to work in-office in Indore, please share your resume or portfolio to proceed. 👍`;
    }
  }

  // 9. TOOLS / SKILLS / RESPONSIBILITIES
  if (text.includes('tool') || text.includes('skill') || text.includes('software') || text.includes('responsibilit') || text.includes('kaam kya') || text.includes('karna padega')) {
    const role = candidate.role || 'SEO Expert';
    if (role.toLowerCase().includes('seo')) {
      if (isHinglish) {
        return `${greetingHi}\n\n🔍 *SEO Expert Role & Tools:*\n- Key Tools: Google Search Console, Ahrefs / SEMrush, Screaming Frog, WordPress\n- Responsibilities: On-Page, Off-Page, Technical SEO, Keyword Research, and Google Page 1 Ranking.\n\nKripya apna updated resume yahan share karein! 📄`;
      } else {
        return `${greetingEn}\n\n🔍 *SEO Expert Role & Tools:*\n- Key Tools: Google Search Console, Ahrefs, SEMrush, Screaming Frog, WordPress\n- Scope: On-Page, Off-Page, Technical SEO, Backlink Strategy, and Google Rankings.\n\nPlease share your updated resume to proceed! 📄`;
      }
    } else {
      if (isHinglish) {
        return `${greetingHi}\n\n🎬 *Video Editor Role & Tools:*\n- Key Tools: Adobe Premiere Pro, After Effects, Photoshop (or DaVinci Resolve)\n- Scope: High-retention Instagram Reels, YouTube videos, Commercial ads, and Motion graphics.\n\nKripya apna Portfolio / Drive link share karein! 🎥`;
      } else {
        return `${greetingEn}\n\n🎬 *Video Editor Role & Tools:*\n- Key Tools: Adobe Premiere Pro, After Effects, Photoshop (or DaVinci Resolve)\n- Scope: Viral Reels editing, YouTube content, Commercial client ads, sound design & motion graphics.\n\nPlease share your Portfolio or Google Drive link of past work! 🎥`;
      }
    }
  }

  // 10. ACKNOWLEDGEMENTS
  const ackPhrases = ['ok', 'okay', 'will do', 'theek hai', 'thik h', 'sure', 'thanks', 'thank you', 'done', 'aata hu', 'aa jaunga', 'ha', 'haa', 'yes', 'got it', 'bilkul', 'alright'];
  if (ackPhrases.includes(clean) || clean.startsWith('ok ') || clean.startsWith('sure ')) {
    if (candidate.interviewDateTime) {
      if (isHinglish) {
        return `${greetingHi} Bohot badhiya! Aapka interview scheduled hai for *${interviewFormatted}* at 103 Orange Business Park, Bhawarkua, Indore. Hum aapse milne ke liye eager hain! 😊📍`;
      } else {
        return `${greetingEn} Great! Your interview is confirmed for *${interviewFormatted}* at 103 Orange Business Park, Bhawarkua, Indore. We look forward to meeting you! 😊📍`;
      }
    } else if (candidate.resumeReceived) {
      if (isHinglish) {
        return `${greetingHi} Aap interview ke liye kis din aur time visit karna chahenge? (Mon-Sat, 10 AM se 6 PM ke beech) 📅`;
      } else {
        return `${greetingEn} When would you like to visit our Indore office for your in-person interview? (Mon-Sat, 10 AM - 6 PM) 📅`;
      }
    } else {
      if (isHinglish) {
        return `${greetingHi} Kripya apna updated *Resume (PDF)* ya *Portfolio link* share karein taaki hum interview schedule kar sakein. 📄✨`;
      } else {
        return `${greetingEn} Please share your updated *Resume (PDF)* or *Portfolio link* whenever ready so we can schedule your interview! 📄✨`;
      }
    }
  }

  // 11. CANDIDATE HAS EXISTING HISTORY (Follow-up greeting)
  if (candidate.chatHistory && candidate.chatHistory.length > 2) {
    if (candidate.resumeReceived && !candidate.interviewDateTime) {
      return isHinglish
        ? `${greetingHi}\nAap in-person interview ke liye kab visit karna chahenge? (Mon-Sat, 10:00 AM – 6:00 PM) 📅`
        : `${greetingEn}\nWhen would you like to visit our Indore office for an in-person interview? (Mon-Sat, 10:00 AM – 6:00 PM) 📅`;
    }
    if (candidate.role && candidate.role !== 'General Applicant') {
      return isHinglish
        ? `${greetingHi}\nKripya apna updated *Resume (PDF)* ya *Portfolio link* share karein taaki hum aapka interview process aage badhayein! 📄✨`
        : `${greetingEn}\nPlease share your updated *Resume (PDF)* or *Portfolio link* to proceed with your interview schedule! 📄💼`;
    }
  }

  // 12. DEFAULT WELCOME GREETING (Only for fresh start)
  if (isHinglish) {
    return `${greetingHi}\nBrandSetu Digital me aapka swagat hai!\n\nHum hiring kar rahe hain for:\n1️⃣ *SEO Expert*\n2️⃣ *Video Editor*\n\n📍 *Office:* 103 Orange Business Park, Bhawarkua, Indore (In-Office Full Time)\n\n👉 Kripya apna *Name*, *Role* (SEO Expert ya Video Editor) aur *Resume / Portfolio link* yahan share karein. 📄✨`;
  } else {
    return `${greetingEn}\nWelcome to BrandSetu Digital!\n\nWe are actively hiring for:\n1️⃣ *SEO Expert*\n2️⃣ *Video Editor*\n\n📍 *Location:* 103 Orange Business Park, Bhawarkua, Indore (In-Office Full Time)\n\n👉 Please share your *Name*, *Role you are applying for*, and your *Resume / Portfolio link* to proceed! 📄💼`;
  }
}

function cleanAiResponseText(rawText) {
  if (!rawText) return '';
  let text = rawText.trim();
  text = text.replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/i, '').trim();
  text = text.replace(/^(?:(?:\d+\s+to\s+\d+|candidate\s+name|rule\s+\d+|check|yes|no|\*|\-|\#|address\s+candidate|sentences?\?)[\s\S]*?\n\n)+/i, '');
  text = text.replace(/^(?:[A-Za-z0-9\s\?\'\"]+\?\s*Yes(?:\s*\([^\)]*\))?\.?\s*\n*)+/i, '');
  text = text.replace(/^(?:Yes\s*\([^\)]*\)\.?\s*|No\s*\([^\)]*\)\.?\s*)+/i, '');
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
    role: candidate.role && candidate.role !== 'General Applicant' ? candidate.role : 'Unknown',
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
You are the professional, friendly HR & Recruitment Coordinator for BrandSetu Digital (Indore).
  `.trim();

  const prompt = `
${systemInstructions}

COMPANY INFORMATION & KNOWLEDGE BASE:
${aiConfig.knowledgeBase}

CANDIDATE CONTEXT:
- Candidate Name: ${candidateSummary.name}
- Role Applied: ${candidateSummary.role}
- Resume / Portfolio Status: ${candidateSummary.resumeReceived}
- Interview Status: ${candidateSummary.interviewScheduled}

RECENT CHAT HISTORY:
${historyLines ? historyLines : '(Start of chat)'}

LATEST CANDIDATE MESSAGE:
"${userMessage}"

STRICT HIRING INSTRUCTIONS:
1. ONLY HIRING FOR: 1. SEO Expert and 2. Video Editor (In-Office at Bhawarkua, Indore).
2. IF CANDIDATE APPLIES FOR ANY OTHER ROLE (e.g. Website Developer, Graphic Designer, Content Writer, Sales, Telecaller, etc.):
   Politely state that we are currently ONLY hiring for SEO Expert and Video Editor, we do not have openings for that role right now, and we will keep their profile on file for future opportunities.
3. IF CANDIDATE SELECTS SEO EXPERT OR VIDEO EDITOR:
   Acknowledge the role warmly and ask them to share their Resume (PDF) or Portfolio link to schedule their in-person interview.
4. IF CANDIDATE HAS SHARED RESUME/PORTFOLIO:
   Thank them and invite them for an in-person interview at our Indore office (Mon-Sat, 10 AM - 6 PM). Ask what day and time works best for them.
5. PREVENT REPETITIVE GREETINGS: Do NOT repeat the full welcome message if chat has already started. Greet warmly by name without "ji".
6. OUTPUT ONLY the final WhatsApp message directly. No thinking, no checklists, no notes.

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
