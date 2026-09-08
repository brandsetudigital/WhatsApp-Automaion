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
  if (!text) return 'hinglish';
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hindi';
  }
  const clean = text.toLowerCase().trim();
  const strongHinglishWords = [
    'kese', 'kaise', 'kaha', 'kahan', 'batao', 'bataye', 'batayein', 'hoga',
    'krte', 'karte', 'karna', 'chahiye', 'mera', 'meri', 'mere', 'aapse',
    'krna', 'bhi', 'kuchh', 'achha', 'accha', 'kitna', 'kitni', 'milega',
    'milegi', 'lagega', 'aa sakta hu', 'aa skta hu', 'dopahar', 'baje',
    'kya', 'hai', 'h', 'hum', 'aap', 'ji', 'theek', 'thik', 'bhejo', 'bheja',
    'aana', 'jana', 'kab', 'kis', 'parso', 'kal', 'nhi', 'nahi', 'mujhe',
    'bhai', 'sir', 'haan', 'sahi', 'dekh', 'raha', 'rahi', 'karein', 'karo',
    'aunga', 'aungi', 'aaunga', 'aaungi', 'krunga', 'karunga', 'denge', 'bhej'
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
    'gemini-flash-latest',
    'gemini-3.6-flash',
    'gemini-3.1-pro-preview'
  ];

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.65,
          maxOutputTokens: options.maxTokens ?? 3000,
          thinkingConfig: { thinkingBudget: 0 }
        }
      };

      if (options.jsonMode) {
        payload.generationConfig.responseMimeType = 'application/json';
      }

      let response;
      try {
        response = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: options.timeout ?? 12000
        });
      } catch (postErr) {
        const errMsg = postErr.response?.data?.error?.message || '';
        // If model doesn't support thinkingConfig, retry without it
        if (errMsg.includes('thinkingConfig') || errMsg.includes('invalid argument') || errMsg.includes('Invalid JSON')) {
          delete payload.generationConfig.thinkingConfig;
          response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: options.timeout ?? 12000
          });
        } else {
          throw postErr;
        }
      }

      const candidate = response.data?.candidates?.[0];
      if (candidate && candidate.content?.parts?.[0]?.text) {
        const text = candidate.content.parts[0].text.trim();
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn(`⚠️ Warning: Gemini response was cut off by MAX_TOKENS on model ${model}`);
        }
        return { text, model };
      }
    } catch (err) {
      const errDetail = err.response?.data?.error?.message || err.message;
      console.warn(`⚠️ Gemini model [${model}] error: ${errDetail}`);
      // Continue to next model on 429 or any error
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
      } catch (e2) { }
    }
  }
  return null;
}

/**
 * Detect if incoming candidate message is a simple acknowledgment / closing / trivial reply
 */
function isAcknowledgementMessage(rawText) {
  if (!rawText) return false;
  const text = String(rawText).toLowerCase().trim();
  const clean = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return false;

  const directPhrases = [
    'ok', 'okay', 'thik h', 'thik hai', 'theek hai', 'theek h', 'haa thik h', 'ha thik h',
    'haa theek h', 'ha theek h', 'haa theek hai', 'ha theek hai', 'haa thik', 'ha thik',
    'haa', 'ha', 'haan', 'yes', 'yep', 'yeah', 'done', 'ji', 'ji sir', 'sir', 'sure',
    'alright', 'all right', 'thanks', 'thank you', 'shukriya', 'got it', 'confirm',
    'hmm', 'hm', 'hmmm', 'hmmmm', 'acha', 'accha', 'achha', 'acha ji', 'accha ji',
    'sahi h', 'sahi hai', 'k', 'kk', 'okk', 'okey', 'okay sir', 'ok sir', 'done sir',
    'yes sir', 'ha sir', 'haa sir', 'haan sir', 'thik hai sir', 'thik h sir', 'thik h ji',
    'bilkul', 'bilkul sir', 'see you', 'bye', 'good', 'nice', 'great', 'perfect', 'hm ji'
  ];

  if (directPhrases.includes(clean)) return true;

  const tokens = clean.split(' ').filter(Boolean);
  const ackVocab = new Set([
    'ok', 'okay', 'okk', 'okey', 'sir', 'done', 'thik', 'theek', 'hai', 'h', 'thanks',
    'thank', 'you', 'shukriya', 'ji', 'alright', 'sure', 'yes', 'ha', 'haa', 'haan',
    'confirm', 'got', 'it', 'hm', 'hmm', 'hmmm', 'hmmmm', 'acha', 'accha', 'achha',
    'sahi', 'bye', 'good', 'nice', 'great', 'k', 'kk', 'bilkul', 'perfect', 'see'
  ]);

  return tokens.length > 0 && tokens.every(t => ackVocab.has(t));
}

/**
 * Detect if incoming candidate message expresses lack of interest, cancellation, or rejection
 */
function isNotInterestedMessage(rawText) {
  if (!rawText) return false;
  const text = String(rawText).toLowerCase().trim();
  const clean = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return false;

  const notInterestedPhrases = [
    'not interested',
    'not intrested',
    'not interest',
    'not intrest',
    'not intersted',
    'nhi chahiye',
    'nahi chahiye',
    'nhi chaiye',
    'nahi chaiye',
    'job nahi chahiye',
    'job nhi chahiye',
    'job nahi krna',
    'job nhi krna',
    'no need',
    'dont need',
    'don t need',
    'no thanks',
    'no thank you',
    'not looking for job',
    'not looking',
    'already placed',
    'placed',
    'got another job',
    'got a job',
    'kahi aur lag gayi',
    'kahi aur ho gaya',
    'dusri jagah ho gaya',
    'dusri company me ho gaya',
    'drop',
    'cancel my interview',
    'cancel interview',
    'interview cancel',
    'cancel it',
    'nahi aana',
    'nhi aana',
    'nahi aaunga',
    'nhi aaunga',
    'nahi aaungi',
    'nhi aaungi',
    'stop',
    'unsubscribe',
    'don t message',
    'dont message',
    'mat karo message',
    'mat bhejo',
    'mat karo'
  ];

  for (const phrase of notInterestedPhrases) {
    if (clean === phrase || clean.startsWith(phrase + ' ') || clean.endsWith(' ' + phrase) || clean.includes(' ' + phrase + ' ')) {
      return true;
    }
    if (clean === phrase) return true;
  }

  // Regex check for tight matches
  if (/\b(?:not\s*inter[a-z]*|nhi\s*chahi[a-z]*|nahi\s*chahi[a-z]*|no\s*need|already\s*placed|kahi\s*aur\s*lag\s*gayi|cancel\s*interview|interview\s*cancel|nahi\s*aana|nhi\s*aana)\b/i.test(text)) {
    return true;
  }

  return false;
}

/**
 * Detect candidate arrival or on-the-way status
 */
function isArrivalStatusMessage(rawText) {
  if (!rawText) return false;
  const text = String(rawText).toLowerCase().trim();
  return /(?:aa\s*raha|a\s*rha|aa\s*rahi|a\s*rhi|aa\s*rahe|a\s*rhe|pahuch|on\s*the\s*way|coming|i\s*am\s*coming|reception|office\s*ke\s*bahar|office\s*me\s*hu|gate\s*par|pahunch)/i.test(text);
}

/**
 * Detect short greeting
 */
function isGreetingMessage(rawText) {
  if (!rawText) return false;
  const clean = String(rawText).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:hi|hii|hiii|hiiii|hello|helo|hey|heyy|namaste|namaskar|good\s*morning|good\s*afternoon|good\s*evening)(?:\s+(?:sir|maam|madam|mam|bro|team|brandsetu))?$/i.test(clean);
}

/**
 * Detect questions about documents/portfolio to bring (handles phonetic typos like dacument, docoment, lane h)
 */
function isDocumentQuery(rawText) {
  if (!rawText) return false;
  const text = String(rawText).toLowerCase().trim();
  return /(?:d[aoe]c[uo]ment|doc\b|paper\b|kya\s*(?:kya\s*)?la(?:na|ne|kar|ke)|kya\s*(?:le\s*)?jana|kya\s*lekar|resume\s*la(?:na|ne)|hard\s*copy|print\s*out|printout|kya\s*chahiye|sath\s*me\s*kya|saath\s*me\s*kya|sath\s*kya|kya\s*leke)/i.test(text);
}

/**
 * Detect queries about part-time, limited hours, or short working shifts (e.g. "2 and half hrs in a day", "2 ghante")
 */
function isPartTimeQuery(rawText) {
  if (!rawText) return false;
  const text = String(rawText).toLowerCase().trim();
  return /(?:\b(?:2|3|4|5)\s*(?:and\s*(?:a\s*)?half\s*)?(?:hr|hrs|hour|hours|ghante|ghanta)\b|part\s*time|parttime|half\s*day|short\s*(?:time|hours)|flexible\s*hours|few\s*hours|2\s*ghante|3\s*ghante|kuch\s*ghante)/i.test(text);
}

/**
 * Detect Meta/Instagram/Facebook ad pre-filled messages and general info queries
 */
function isAdInquiryMessage(rawText) {
  if (!rawText) return false;
  const text = String(rawText).toLowerCase().trim();
  const clean = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const adPhrases = [
    'can i get more info',
    'get more info',
    'more info',
    'more information',
    'more details',
    'share details',
    'share more',
    'saw your ad',
    'saw ad',
    'on instagram',
    'from instagram',
    'on facebook',
    'from facebook',
    'interested in this',
    'interested in job',
    'tell me more',
    'info on this',
    'kya details hai',
    'kya opening hai',
    'details batao',
    'details chahiye',
    'info chahiye',
    'info please',
    'details please',
    'want to know more',
    'know more',
    'about this job',
    'job info',
    'ad info'
  ];

  if (adPhrases.some(p => text.includes(p))) {
    return true;
  }

  if (clean === 'info' || clean === 'details' || clean === 'detail' || clean === 'interested') {
    return true;
  }

  return false;
}

/**
 * Detect completely off-topic / non-hiring messages (e.g. casual chit-chat, jokes, weather, loans, abusive, random nonsense)
 */
function isOffTopicMessage(rawText, candidate = null) {
  if (!rawText) return false;
  const text = String(rawText).toLowerCase().trim();
  const clean = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length < 2) return false;

  // Standard hiring intents & ad inquiries are NEVER off-topic
  if (
    isGreetingMessage(text) ||
    isAdInquiryMessage(text) ||
    isAcknowledgementMessage(text) ||
    isNotInterestedMessage(text) ||
    isArrivalStatusMessage(text) ||
    isDocumentQuery(text) ||
    isPartTimeQuery(text)
  ) {
    return false;
  }

  // Pure role number selections e.g. "1", "2", "3", "4", "5", "6"
  if (/^[1-6]$/.test(clean) || /^[1-6]\s+(?:role|job|apply|me|chahiye)?$/i.test(clean)) {
    return false;
  }

  // 1. Explicit off-topic phrases & patterns (flirting, random chit-chat, personal questions, songs, jokes, abuse, loans, random sales)
  const offTopicPatterns = [
    /kya\s*(?:kr|kar)\s*rahe\s*ho/i,
    /kya\s*kar\s*rhe\s*ho/i,
    /kya\s*kar\s*rhi\s*ho/i,
    /khana\s*khaya/i,
    /dinner\s*(?:ho\s*gaya|kiya)/i,
    /lunch\s*(?:ho\s*gaya|kiya)/i,
    /aap\s*(?:kon|koun)\s*ho/i,
    /tum\s*(?:kon|koun)\s*ho/i,
    /who\s*are\s*you/i,
    /song\s*(?:sunao|bhejo)/i,
    /gaana\s*sunao/i,
    /joke\s*sunao/i,
    /shayari\s*sunao/i,
    /weather/i,
    /mausam/i,
    /cricket\s*score/i,
    /match\s*kaise/i,
    /movie\s*kaisi/i,
    /single\s*ho/i,
    /friendship\s*karoge/i,
    /dosti\s*karoge/i,
    /love\s*you/i,
    /miss\s*you/i,
    /aur\s*batao/i,
    /aur\s*btao/i,
    /aur\s*kya\s*chal\s*raha/i,
    /kya\s*chal\s*rha/i,
    /bor\s*ho\s*raha/i,
    /bore\s*ho\s*raha/i,
    /loan\s*chahiye/i,
    /paise\s*udhar/i,
    /product\s*kharidna/i,
    /rider/i,
    /bike/i,
    /delivery/i,
    /driver/i,
    /courier/i,
    /swiggy/i,
    /zomato/i,
    /rapido/i,
    /uber/i,
    /ola/i
  ];

  if (offTopicPatterns.some(p => p.test(text))) {
    return true;
  }

  // 2. Comprehensive hiring keywords
  const hiringKeywords = [
    'video', 'editor', 'editing', 'reels', 'ai', 'graphic', 'designer', 'design',
    'seo', 'aeo', 'social', 'media', 'smm', 'digital', 'marketing', 'job', 'jobs', 'hiring', 'higing', 'hire',
    'apply', 'intern', 'internship', 'fresher', 'freshor', 'experienced', 'experience', 'salary',
    'stipend', 'ctc', 'package', 'resume', 'cv', 'portfolio', 'pdf', 'link', 'drive',
    'behance', 'figma', 'github', 'youtube', 'interview', 'time', 'date', 'kal', 'aaj',
    'parso', 'baje', 'am', 'pm', 'morning', 'afternoon', 'evening', 'office', 'location',
    'address', 'bhawarkua', 'orange', 'hospital', 'indore', 'wfh', 'remote', 'work',
    'role', 'position', 'openings', 'vacancy', 'vacancies', 'documents', 'doc', 'kaam', 'detail',
    'details', 'info', 'information', 'ad', 'ads', 'instagram', 'facebook', 'post', 'story',
    'jd', 'description', 'google meet', 'online', 'reschedule', 'cancel', 'sir', 'maam',
    'number', 'hr', 'contact', 'call', 'joining', 'join', 'start', 'qualification', 'skills',
    'exp', 'months', 'years', 'saal', 'mahine', 'bheja', 'send', 'share', 'haan', 'yes', 'no',
    'web', 'website', 'developer', 'development', 'software', 'app', 'android', 'ios', 'flutter',
    'react', 'python', 'java', 'node', 'fullstack', 'frontend', 'backend', 'telecaller', 'telecalling',
    'calling', 'caller', 'sales', 'bpo', 'receptionist', 'accountant', 'accounts', 'finance',
    'content', 'writer', 'writing', 'copywriter', 'data entry', 'back office', 'assistant',
    'naukri', 'recruitment', 'opening', 'opportunity', 'post', 'posts', 'kya', 'kaise', 'batao',
    'bataye', 'bataiye', 'chahiye', 'interested', 'know', 'tell', 'help'
  ];

  const words = clean.split(' ');
  const hasHiringKeyword = words.some(w => hiringKeywords.includes(w)) ||
    hiringKeywords.some(k => text.includes(k));

  if (hasHiringKeyword) {
    return false;
  }

  // A brand new candidate or someone in initial stages (chatHistory <= 2) should NEVER get an off-topic warning unless explicit offTopicPattern matched above!
  const chatCount = (candidate && candidate.chatHistory) ? candidate.chatHistory.length : 0;
  if (!candidate || candidate.role === 'General Applicant' || chatCount <= 2) {
    return false;
  }

  // In ongoing chats, only flag if long message with zero hiring keywords
  if (words.length >= 4 && !hasHiringKeyword) {
    return true;
  }

  return false;
}

function getOffTopicBoundaryResponse(lang) {
  const isHinglish = (lang === 'hinglish' || lang === 'hindi');
  return isHinglish
    ? `Yeh WhatsApp helpline strictly Brand Setu Digital ki hiring aur active job roles ke liye hai. 😊 Kripya open positions se related hi message karein. Dhanyawad! 🙏`
    : `This helpline is strictly reserved for Brand Setu Digital recruitment & active job roles. 😊 Please message regarding our open positions. Thank you! 🙏`;
}

function getOffTopicWarningResponse(count, lang = 'hinglish') {
  const isHinglish = (lang === 'hinglish' || lang === 'hindi');
  const num = Number(count) || 1;

  if (num === 1) {
    return isHinglish
      ? `⚠️ *Warning (1/3):* Yeh helpline strictly Brand Setu Digital ki hiring aur active job roles (*Video Editor, AI Video Expert, Graphic Designer, SEO & AEO Expert, Social Media Manager, Digital Marketing Manager*) ke liye hai. 😊\n\nKripya hiring se related hi message karein. Dhanyawad! 🙏`
      : `⚠️ *Warning (1/3):* This helpline is strictly reserved for Brand Setu Digital recruitment & active job roles (*Video Editor, AI Video Expert, Graphic Designer, SEO & AEO Expert, Social Media Manager, Digital Marketing Manager*). 😊\n\nPlease message only regarding our hiring. Thank you! 🙏`;
  }

  if (num === 2) {
    return isHinglish
      ? `⚠️ *Warning (2/3):* Yeh helpline strictly Brand Setu Digital hiring ke liye hai. Kripya sirf job roles se related message karein, anyatha chat automatically close kar di jayegi. 🙏`
      : `⚠️ *Warning (2/3):* This helpline is strictly for Brand Setu Digital recruitment. Please message regarding job positions only, otherwise this conversation will be closed. 🙏`;
  }

  // num >= 3: Final Close
  return isHinglish
    ? `🛑 *Chat Closed:* Baar-baar off-topic messages aane ke karan yeh conversation ab close kar di gayi hai. Hum aapko aage disturb nahi karenge. Best wishes! ✨`
    : `🛑 *Chat Closed:* Due to repeated off-topic messages, this conversation has now been closed. We will not disturb you further. Best wishes! ✨`;
}




function parseInterviewScheduleLocal(userMessage, candidate = null) {
  if (!userMessage) return null;
  const rawText = String(userMessage).trim();
  const text = rawText.toLowerCase();

  // 0. Check if message is a third-party recruiter forward (e.g. IIFL Securities, other HR)
  const hiringService = require('./hiring.service');
  if (hiringService.isThirdPartyRecruitmentForward(userMessage)) {
    return null;
  }

  // 0.1 Interview scheduling is strictly allowed ONLY if candidate has submitted resume or received slot proposal
  if (candidate && !candidate.resumeReceived && !candidate.interviewSlotProposed) {
    return null;
  }

  // 0.2 If candidate ALREADY has an interview scheduled:
  if (candidate && candidate.interviewDateTime) {
    // Pure acknowledgments, arrival updates, greetings, doc questions must NEVER reschedule
    if (isAcknowledgementMessage(text) || isArrivalStatusMessage(text) || isGreetingMessage(text) || isDocumentQuery(text)) {
      return null;
    }

    // Must have explicit reschedule keyword OR explicit new day/time to allow rescheduling
    const hasExplicitReschedule = /(?:reschedule|shift|instead|change\s*time|dusre\s*din|dusra\s*time|time\s*badal)/i.test(text);
    const hasExplicitDay = /\b(tomorrow|kal|aaj|today|parso|parson|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
    const hasExplicitTime = /(?:\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b|\b(?:dopahar|subah|shaam)\s*\d{1,2}\b)/i.test(text);

    // If there is no explicit day/time and no explicit reschedule keyword, DO NOT reschedule
    if (!hasExplicitReschedule && !hasExplicitDay && !hasExplicitTime) {
      return null;
    }
  }

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

  // 4. Check for Affirmative Confirmation (Only when interview slot is pending/not scheduled yet)
  const affirmativePattern = /^(?:ha|haan|haa|yes|yep|yeah|ok|okay|sure|done|theek|thik|theek\s*hai|thik\s*h|thik\s*hai|aunga|aungi|aa\s*jaunga|aa\s*jaungi|aa\s*sakta\s*hu|aa\s*sakti\s*hu|chalega|confirm|yes\s*sir|ha\s*sir|ha\s*aa\s*jaunga|kal\s*aa\s*jaunga|kal\s*aa\s*sakta\s*hu|ha\s*kal|yes\s*tomorrow)(?:[\s,!.].*)?$/i;
  const isAffirmative = (!candidate || !candidate.interviewDateTime) && affirmativePattern.test(text);

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

  const hiringService = require('./hiring.service');
  if (hiringService.isThirdPartyRecruitmentForward(userMessage)) {
    return null;
  }

  if (candidate && !candidate.resumeReceived && !candidate.interviewSlotProposed) {
    return null;
  }

  if (candidate && candidate.interviewDateTime) {
    if (isAcknowledgementMessage(userMessage) || isArrivalStatusMessage(userMessage) || isGreetingMessage(userMessage) || isDocumentQuery(userMessage)) {
      return null;
    }
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
Candidate already has scheduled interview: ${candidate && candidate.interviewDateTime ? candidate.interviewDateTime : 'No'}

Instructions:
1. Determine if candidate is proposing/confirming a specific date, day, or time when they CAN come for an in-person interview (e.g., "Tomorrow at 2 PM", "Monday 11 AM", "Kal 3 baje aa jaunga", "Today at 4 PM", "Reschedule to today 5 PM").
2. If candidate says simple acknowledgment ("ok", "thik h", "done", "yes", "sure", "thanks", "hmm", "haa thik h") and already has an interview scheduled, set isScheduling to false!
3. If candidate says they CANNOT come without proposing a new time, set isScheduling to false!
4. If candidate is explicitly scheduling or rescheduling to a specific time, compute the target date-time in ISO-8601 string format with "+05:30" offset (e.g. "2026-08-21T14:00:00+05:30"). Office hours: 10:00 AM to 06:00 PM.
5. If NO, set isScheduling to false.

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
 * Get tailored, role-specific Job Description (JD) for Fresher vs Experienced
 */
function getDetailedJobDescription(role, experience, lang) {
  const isHinglish = (lang === 'hinglish' || lang === 'hindi');
  const isFresher = String(experience || '').toLowerCase().includes('fresher') || String(experience || '').toLowerCase().includes('intern');

  if (role === 'Digital Marketing Manager') {
    if (isFresher) {
      return isHinglish
        ? `📋 *Job Description (JD) — Digital Marketing Intern (Paid Internship):*\n• Scope: Meta Ads (FB/Insta) & Google Ads campaign setup me assist karna, creative ad copy research, daily lead flow monitor karna aur performance analytics sikhna.\n• Duration & Mode: 3-6 Months Paid Internship (In-Office, Indore).\n• Benefits: Handsome stipend, certificate of completion, live ad budgets handling & pre-placement / full-time job offer.`
        : `📋 *Job Description (JD) — Digital Marketing Manager (Full-Time):*\n• Scope: Scaling high-budget Meta & Google Paid Ads, lead generation funnels, conversion rate optimization (CRO), ROAS maximization, A/B creative testing & client ROI strategy.\n• Mode: Full-Time In-Office (Indore).\n• Benefits: Competitive salary + performance incentives & campaign leadership.`;
    } else {
      return isHinglish
        ? `📋 *Job Description (JD) — Digital Marketing:*\n• Paid Internship: Meta & Google Ads setup, ad copywriting, audience targeting & daily lead generation assistance.\n• Full-Time: High-budget ad scaling, ROAS optimization, funnel strategy & client ROI management.\n• Mode: Onsite / In-Office (Indore).`
        : `📋 *Job Description (JD) — Digital Marketing:*\n• Paid Internship: Assisting in Meta/Google Ad campaigns, audience targeting, copywriting & analytics.\n• Full-Time: Managing high-budget ad funnels, maximizing ROAS, CRO & client performance strategy.\n• Mode: Onsite / In-Office (Indore).`;
    }
  }

  if (role === 'Video Editor') {
    if (isFresher) {
      return isHinglish
        ? `📋 *Job Description (JD) — Video Editing Intern (Paid Internship):*\n• Scope: Instagram viral reels, shorts, dynamic cuts, animated typography subtitles, sound effects (SFX) aur creative motion graphics create karna.\n• Tools: Adobe Premiere Pro, After Effects, CapCut Pro.\n• Benefits: Handsome stipend, certificate & expert mentorship.`
        : `📋 *Job Description (JD) — Video Editor (Full-Time):*\n• Scope: End-to-end commercial video production, brand ad campaigns, YouTube long-form, multi-cam editing, advanced color grading & sound design.\n• Tools: Adobe Premiere Pro, After Effects, DaVinci Resolve.`;
    } else {
      return isHinglish
        ? `📋 *Job Description (JD) — Video Editor:*\n• Scope: Viral Instagram reels, commercial ads, YouTube long-form, dynamic cuts, SFX & motion graphics.\n• Tools: Premiere Pro, After Effects, DaVinci Resolve.\n• Mode: Onsite / In-Office (Indore).`
        : `📋 *Job Description (JD) — Video Editor:*\n• Scope: High-retention Instagram reels, commercial video ads, YouTube content, sound design & motion graphics.\n• Tools: Adobe Premiere Pro, After Effects, DaVinci Resolve.\n• Mode: Onsite / In-Office (Indore).`;
    }
  }

  if (role === 'AI Video Expert') {
    if (isFresher) {
      return isHinglish
        ? `📋 *Job Description (JD) — AI Video Intern (Paid Internship):*\n• Scope: AI prompt engineering, AI character animations, text-to-video generation, lip-sync & voice cloning ads create karna.\n• Tools: Midjourney, Runway (Gen-2/Gen-3), Kling AI, Luma Dream Machine, ElevenLabs.\n• Benefits: Paid stipend, AI workflows training & live client projects.`
        : `📋 *Job Description (JD) — AI Video Expert (Full-Time):*\n• Scope: Production-grade AI commercial generation, character consistency across scenes, realistic VFX & automated AI video workflows.\n• Tools: Runway Gen-3, Kling, Midjourney, Luma, HeyGen, Topaz AI, Premiere Pro.`;
    } else {
      return isHinglish
        ? `📋 *Job Description (JD) — AI Video Expert:*\n• Scope: AI prompt engineering, hyper-realistic video generation, avatar animations & AI video ads.\n• Tools: Midjourney, Runway, Kling AI, Luma, ElevenLabs.\n• Mode: Onsite / In-Office (Indore).`
        : `📋 *Job Description (JD) — AI Video Expert:* \n• Scope: AI video generation, prompt engineering pipelines, character animation & AI commercial production.\n• Tools: Runway, Kling AI, Midjourney, Luma, HeyGen.\n• Mode: Onsite / In-Office (Indore).`;
    }
  }

  if (role === 'Graphic Designer') {
    if (isFresher) {
      return isHinglish
        ? `📋 *Job Description (JD) — Graphic Design Intern (Paid Internship):*\n• Scope: Social media post designs, promotional banners, YouTube thumbnails, typography layout & story creatives design karna.\n• Tools: Adobe Photoshop, Illustrator, Figma, Canva Pro.\n• Benefits: Paid stipend, portfolio building & full-time placement.`
        : `📋 *Job Description (JD) — Graphic Designer (Full-Time):*\n• Scope: Complete brand identity design, high-converting Meta/Google ad creatives, packaging design, pitch decks & creative direction.\n• Tools: Adobe Photoshop, Illustrator, Figma, InDesign.`;
    } else {
      return isHinglish
        ? `📋 *Job Description (JD) — Graphic Designer:*\n• Scope: Social media creatives, high-converting ad banners, brand identity & thumbnail design.\n• Tools: Photoshop, Illustrator, Figma.\n• Mode: Onsite / In-Office (Indore).`
        : `📋 *Job Description (JD) — Graphic Designer:*\n• Scope: Brand identity, social media creatives, high-converting ad banners & visual storytelling.\n• Tools: Adobe Photoshop, Illustrator, Figma.\n• Mode: Onsite / In-Office (Indore).`;
    }
  }

  if (role === 'SEO & AEO Expert') {
    if (isFresher) {
      return isHinglish
        ? `📋 *Job Description (JD) — SEO & AEO Intern (Paid Internship):*\n• Scope: Keyword research, on-page SEO optimization, meta tags, content structure, blog publishing & AI Search (AEO/ChatGPT) ranking basics.\n• Tools: Google Search Console, Google Analytics, WordPress, SEMrush/Ahrefs basics.\n• Benefits: Paid stipend, live client ranking experience & certification.`
        : `📋 *Job Description (JD) — SEO & AEO Expert (Full-Time):*\n• Scope: Comprehensive Technical SEO audits, Page 1 Google ranking strategies, Answer Engine Optimization (AEO for ChatGPT/Perplexity/Gemini), high-authority backlink building & organic lead generation.\n• Tools: Ahrefs, SEMrush, Screaming Frog, GSC, GA4, WordPress.`;
    } else {
      return isHinglish
        ? `📋 *Job Description (JD) — SEO & AEO Expert:*\n• Scope: Google Page 1 ranking strategies, On-Page/Off-Page/Technical SEO, AI Search (AEO) visibility & backlink building.\n• Tools: Ahrefs, SEMrush, Google Search Console, Screaming Frog.\n• Mode: Onsite / In-Office (Indore).`
        : `📋 *Job Description (JD) — SEO & AEO Expert:*\n• Scope: Technical SEO audits, Page 1 search rankings, Answer Engine Optimization (AEO) & lead acquisition.\n• Tools: Ahrefs, SEMrush, Screaming Frog, GSC, GA4.\n• Mode: Onsite / In-Office (Indore).`;
    }
  }

  if (role === 'Social Media Manager') {
    if (isFresher) {
      return isHinglish
        ? `📋 *Job Description (JD) — Social Media Intern (Paid Internship):*\n• Scope: Content calendar planning, viral reels trend research, engaging captions, hashtag research & audience engagement/community handling.\n• Benefits: Paid stipend, real brand growth experience & certification.`
        : `📋 *Job Description (JD) — Social Media Manager (Full-Time):*\n• Scope: End-to-end social media growth strategy for client brands, viral content scripting, influencer collaborations, lead funnels & monthly ROI reporting.`;
    } else {
      return isHinglish
        ? `📋 *Job Description (JD) — Social Media Manager:*\n• Scope: Managing client Instagram/LinkedIn profiles, viral reels planning, caption copywriting & organic audience growth.\n• Mode: Onsite / In-Office (Indore).`
        : `📋 *Job Description (JD) — Social Media Manager:*\n• Scope: Managing brand social presence, viral reels strategy, copywriting & audience community growth.\n• Mode: Onsite / In-Office (Indore).`;
    }
  }

  // General 6-Roles Overview
  return isHinglish
    ? `📋 *Brand Setu Digital — Hiring Overview (6 Openings):*\n1️⃣ 🎬 Video Editor: Viral Reels, Commercial Ads & Motion Graphics\n2️⃣ 🤖 AI Video Expert: AI Prompts, Character Animation & AI Commercials\n3️⃣ 🎨 Graphic Designer: Social Creatives, Ad Banners & Brand Identity\n4️⃣ 🔎 SEO & AEO Expert: Google Page 1 Ranking & AI Search Visibility\n5️⃣ 📱 Social Media Manager: Profile Growth, Content Calendar & Viral Strategy\n6️⃣ 📢 Digital Marketing Manager: Meta & Google Paid Ads (High ROAS)\n\n• Modes Available: Paid Internship (3-6 Months) & Full-Time Careers (In-Office, Indore).`
    : `📋 *Brand Setu Digital — Hiring Overview (6 Openings):*\n1️⃣ 🎬 Video Editor: Viral Reels, Video Ads & Motion Graphics\n2️⃣ 🤖 AI Video Expert: AI Prompts, Character Animation & AI Commercials\n3️⃣ 🎨 Graphic Designer: Social Creatives, Ad Banners & Brand Identity\n4️⃣ 🔎 SEO & AEO Expert: Google Search & AI Search Visibility (AEO)\n5️⃣ 📱 Social Media Manager: Brand Growth, Content Planning & Trends\n6️⃣ 📢 Digital Marketing Manager: Meta & Google Paid Ad Campaigns\n\n• Available Options: Paid Internship (3-6 Months) & Full-Time Roles (In-Office, Indore).`;
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
  const isHinglish = (lang === 'hinglish' || lang === 'hindi');

  // ── 0. NOT INTERESTED / CANCEL / DROP HANDLING ──
  if (isNotInterestedMessage(text) || candidate.status === 'Not Interested') {
    if (isHinglish) {
      return `Humein batane ke liye dhanyawad! Humne aapka status update kar diya hai. Aapke future ke liye best wishes! ✨`;
    } else {
      return `Thank you for letting us know! We have updated your status and will not disturb you further. We wish you all the best for your future endeavors! ✨`;
    }
  }

  // ── 0.5. OFF-TOPIC / NON-HIRING QUERY HANDLING ──
  if (isOffTopicMessage(text, candidate)) {
    return getOffTopicBoundaryResponse(lang);
  }

  // Conversational Greeting Rule: ONLY greet on initial interaction (chatCount <= 2) or explicit greeting ("hi/hello")
  const chatCount = (candidate.chatHistory || []).length;
  const isInitialGreeting = chatCount <= 2 || isGreetingMessage(userMessage);
  const prefixEn = isInitialGreeting ? (firstName ? `Hello ${firstName}! 😊\n\n` : `Hello! 😊\n\n`) : '';
  const prefixHi = isInitialGreeting ? (firstName ? `Namaste ${firstName}! 🙏\n\n` : `Namaste! 🙏\n\n`) : '';

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

  // ── SPECIAL HANDLING WHEN INTERVIEW IS ALREADY CONFIRMED ──
  if (candidate.interviewDateTime) {
    // 1. Simple Acknowledgment / Closing ("thik h", "ok", "haa thik h", "hmm", "done", "thanks", "sure", etc.)
    if (isAcknowledgementMessage(text)) {
      if (isHinglish) {
        return `Bahut badiya! Interview me milte hain. 👍 All the best! 😊`;
      } else {
        return `Great! Looking forward to meeting you at the interview. 👍 All the best! 😊`;
      }
    }

    // 2. Candidate Arrival / On the way ("aa raha hu", "gate par hu", "reception", "on the way")
    if (isArrivalStatusMessage(text)) {
      if (isHinglish) {
        return `Bahut badiya! 🏢 Hamara office 103 Orange Business Park, Bhawarkua Main Road (Near Apple Hospital) par hai. Office pahunch kar reception par contact karein. 👍`;
      } else {
        return `Great! 🏢 Our office is at 103 Orange Business Park, Bhawarkua Main Road (Near Apple Hospital). Please check in at the reception upon arrival. 👍`;
      }
    }

    // 3. Greeting when interview is already confirmed ("hii", "hello")
    if (isGreetingMessage(text)) {
      if (isHinglish) {
        return `${prefixHi}Kaise hain aap? Interview ke regarding koi question ya help chahiye to batayein! 👍`;
      } else {
        return `${prefixEn}How can I help you regarding your scheduled interview? 👍`;
      }
    }

    // 4. Documents to bring question
    if (isDocumentQuery(text)) {
      if (isHinglish) {
        return `📌 Kripya apna updated *Resume (Hard Copy / PDF)* aur work samples/portfolio saath lekar aayein. 👍`;
      } else {
        return `📌 Please bring your updated *Resume (Hard Copy/PDF)* and work samples/portfolio with you. 👍`;
      }
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
      return `${prefixHi}Filhal Brand Setu Digital me in 6 active roles ke liye hiring chal rahi hai:\n🎬 1. Video Editor\n🤖 2. AI Video Expert\n🎨 3. Graphic Designer\n🔎 4. SEO & AEO Expert\n📱 5. Social Media Manager\n📢 6. Digital Marketing Manager\n\nAbhi hamare paas *${mentionedRole}* ke liye vacancy open nahi hai. Humne aapki details note kar li hain, future opening aane par contact karenge! 👍✨`;
    } else {
      return `${prefixEn}Currently, Brand Setu Digital is actively hiring for these 6 positions:\n🎬 1. Video Editor\n🤖 2. AI Video Expert\n🎨 3. Graphic Designer\n🔎 4. SEO & AEO Expert\n📱 5. Social Media Manager\n📢 6. Digital Marketing Manager\n\nWe do not have active openings for *${mentionedRole}* at the moment. We have saved your profile on file for future opportunities! 👍✨`;
    }
  }

  // 2. OUT OF INDORE / ONLINE GOOGLE MEET INTERVIEW CHECK
  const outOfIndorePattern = /(?:indore\s*se\s*bahar|out\s*of\s*indore|not\s*in\s*indore|bahar\s*hu|bahar\s*rehta|bhopal|delhi|ujjain|dewas|gwaliar|gwalior|jabalpur|raipur|jaipur|pune|mumbai|other\s*city|dusre\s*shehar|online\s*interview|google\s*meet|virtual\s*interview|video\s*call\s*interview|online\s*meet|online\s*kar\s*lo|online\s*ho\s*skta|online\s*ho\s*sakta|online\s*de\s*sakta|online\s*le\s*lo)/i;
  if (outOfIndorePattern.test(text)) {
    candidate.interviewMode = 'online';
    if (isHinglish) {
      return `${prefixHi}Koi baat nahi! Agar aap filhal Indore se bahar hain, toh hum aapka *Online Google Meet Interview* conduct kar sakte hain. 💻✨\n\n👉 Kripya batayein aap kis din aur time par online interview ke liye available hain? (Monday to Saturday, 10:00 AM se 6:00 PM ke beech) 📅\n\n📌 *(Interview shuru hone se 15 minute pehle aapko WhatsApp par Google Meet joining link mil jayegi).* 👍`;
    } else {
      return `${prefixEn}No problem at all! If you are currently outside Indore, we can conduct your interview online via *Google Meet*. 💻✨\n\n👉 Please share your preferred Date and Time when you are available for the online interview (Monday to Saturday, 10:00 AM – 6:00 PM). 📅\n\n📌 *(You will receive the Google Meet joining link on WhatsApp 15 minutes prior to the interview).* 👍`;
    }
  }

  // 3. NEGATION / CANNOT COME TOMORROW / RESCHEDULE REQUEST
  const unablePhrases = /(?:nhi\s*a\s*s[a-z]*|nahi\s*aa\s*s[a-z]*|nahi\s*aa\s*p[a-z]*|nhi\s*aa\s*p[a-z]*|not\s*coming|can'?t\s*come|cannot\s*come|unable\s*to\s*come|not\s*possible|not\s*available|cancel|nahi\s*ho\s*payega|kal\s*nahi|kal\s*nhi|busy\s*hu|busy|kisi\s*aur\s*din|nahi|nhi)/i;
  if (unablePhrases.test(text) && !text.includes('ha') && !text.includes('yes')) {
    if (candidate && candidate.interviewDateTime) {
      candidate.interviewDateTime = null;
      candidate.status = 'Resume Received';
    }
    if (isHinglish) {
      return `${prefixHi}Koi baat nahi! Aap apni suvidha ke anusaar preferred Date aur Time bata dijiye (Monday to Saturday, 10:00 AM se 6:00 PM ke beech) kab aap interview ke liye aa sakte hain? 📅`;
    } else {
      return `${prefixEn}No problem at all! Please share your preferred Date and Time (Monday to Saturday, between 10:00 AM and 6:00 PM) when you would be available to visit for your in-person interview. 📅`;
    }
  }

  // 4. FAQ: SALARY / STIPEND / PAID INTERNSHIP QUESTIONS
  if (text.includes('salary') || text.includes('package') || text.includes('kitna milega') || text.includes('ctc') || text.includes('stipend') || text.includes('paise') || text.includes('per month') || text.includes('pay') || text.includes('internship') || text.includes('certificate')) {
    if (isHinglish) {
      return `${prefixHi}💰 *Salary / Stipend Details:*\nHamare yahan salary / stipend aapke *Experience, Skills aur In-Person Practical Interview* ke basis par decide hoti hai aur interview ke dauraan bata di jayegi. 🤝\n\n${candidate.interviewDateTime ? `Aapka interview already scheduled hai for: *${interviewFormatted}*.` : (candidate.resumeReceived ? '👉 Kya aap kal morning me *10:00 AM se 12:00 PM* ke beech hamare Indore office (*103 Orange Business Park, Bhawarkua*) interview ke liye aa sakte hain?' : (candidate.role && candidate.role !== 'General Applicant' ? 'Kripya apna updated *Resume (PDF)* aur Portfolio link share karein taaki hum interview process aage badha sakein. 📄' : '👉 Aap kis role (1 to 6) ke liye apply karna chahte hain?'))}`;
    } else {
      return `${prefixEn}💰 *Salary / Compensation Details:*\nSalary / stipend is decided based on your *Experience, Skills, and In-Person Practical Interview*, and will be discussed and finalized during the interview. 🤝\n\n${candidate.interviewDateTime ? `Your interview is confirmed for: *${interviewFormatted}*.` : (candidate.resumeReceived ? '👉 Are you available to visit our Indore office tomorrow morning between *10:00 AM and 12:00 PM* for your interview?' : (candidate.role && candidate.role !== 'General Applicant' ? 'Please share your updated Resume (PDF) or Portfolio link so we can schedule your interview. 📄' : '👉 Which position (1 to 6) would you like to apply for?'))}`;
    }
  }

  // 5. FAQ: OFFICE ADDRESS / LOCATION
  if (text.includes('location') || text.includes('address') || text.includes('kahan') || text.includes('kaha') || text.includes('where') || text.includes('office') || text.includes('bhawarkua') || text.includes('apple hospital')) {
    if (isHinglish) {
      return `${prefixHi}📍 *Office Address:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n⏰ *Office Timings:* Mon–Sat (10:00 AM – 7:00 PM)\n📞 *Contact:* +91 9329232025`;
    } else {
      return `${prefixEn}📍 *Office Location:*\n103 Orange Business Park, Bhawarkua Main Road, Near Apple Hospital, Transport Nagar, Indore (M.P.) - 452014\n\n⏰ *Timings:* Monday to Saturday (10:00 AM – 7:00 PM)\n📞 *Contact:* +91 9329232025`;
    }
  }

  // 6. FAQ: WORK FROM HOME / REMOTE
  if (text.includes('wfh') || text.includes('work from home') || text.includes('remote') || text.includes('ghar se')) {
    if (isHinglish) {
      return `${prefixHi}🏢 Yeh Onsite *In-Office* role hai hamare Indore office (103 Orange Business Park, Bhawarkua) ke liye. Remote ya Work-From-Home option available nahi hai.\n\nAgar aap Indore office visit kar sakte hain to kripya apna *Resume (PDF)* share karein. 👍`;
    } else {
      return `${prefixEn}🏢 This is an Onsite *In-Office* position at our Indore office (103 Orange Business Park, Bhawarkua). We currently do not offer remote/work-from-home options.\n\nIf you are available for an in-office role in Indore, please share your Resume (PDF) or portfolio to proceed. 👍`;
    }
  }

  // 6.5. FAQ: PART-TIME / LIMITED HOURS (e.g. "2 and half hrs in a day", "2 ghante", "part time")
  if (isPartTimeQuery(text)) {
    if (isHinglish) {
      return `${prefixHi}🏢 Hamare yahan internships aur full-time roles strictly **Full-Time In-Office (10:00 AM se 7:00 PM, Monday to Saturday)** hote hain hamare Indore office (*103 Orange Business Park, Bhawarkua*) me.\n\nFilhal 2-3 ghante ya Part-Time option available nahi hai. Agar aap full-time in-office internship/job ke liye comfortable hain, toh kripya apna updated **Resume (PDF)** share karein! 👍`;
    } else {
      return `${prefixEn}🏢 All our internship and job opportunities are strictly **Full-Time In-Office (10:00 AM – 7:00 PM, Monday to Saturday)** at our Indore office (*103 Orange Business Park, Bhawarkua*).\n\nWe currently do not offer part-time (2-3 hours/day) roles. If you are available for a full-time in-office role, please share your updated **Resume (PDF)** to proceed! 👍`;
    }
  }

  // 7. FAQ: JOB DESCRIPTION (JD) / WORK RESPONSIBILITIES
  const jdKeywords = /(?:\bjd\b|job\s*description|description|responsibilit|kaam\s*kya|work\s*detail|role\s*detail|profile\s*detail)/i;
  if (jdKeywords.test(text)) {
    const jdText = getDetailedJobDescription(candidate.role, candidate.experience, lang);
    if (isHinglish) {
      return `${prefixHi}${jdText}\n\n${candidate.interviewDateTime ? `Aapka interview already confirmed hai for: *${interviewFormatted}*.` : (candidate.resumeReceived ? `👉 Kya aap kal morning me *10:00 AM se 12:00 PM* ke beech hamare Indore office (*103 Orange Business Park, Bhawarkua*) interview ke liye aa sakte hain? 🏢\n\nKripya confirm karein (Haan / Nahi ya apna time batayein). 👍` : (candidate.role && candidate.role !== 'General Applicant' ? `Kripya apna updated *Resume (PDF)* / Portfolio share karein taaki hum interview process aage badha sakein. 📄` : `👉 Aap inme se kis position ke liye apply karna chahte hain?`))}`;
    } else {
      return `${prefixEn}${jdText}\n\n${candidate.interviewDateTime ? `Your interview is already confirmed for: *${interviewFormatted}*.` : (candidate.resumeReceived ? `👉 Are you available to visit our Indore office (*103 Orange Business Park, Bhawarkua*) for your in-person interview tomorrow morning between *10:00 AM and 12:00 PM*? 🏢\n\nPlease confirm (Yes / No or share your preferred time). 👍` : (candidate.role && candidate.role !== 'General Applicant' ? `Please share your updated Resume (PDF) or Portfolio link so we can schedule your interview. 📄` : `👉 Which position would you like to apply for?`))}`;
    }
  }

  // 8. FAQ: DOCUMENTS REQUIRED (General)
  if (isDocumentQuery(text)) {
    const roleDoc = candidate.role && candidate.role !== 'General Applicant' ? `${candidate.role} work samples/portfolio` : 'work samples/portfolio';
    if (isHinglish) {
      return `${prefixHi}📌 *Documents Required:*\nInterview ke liye aapko apna updated *Resume (Hard Copy / PDF)* aur ${roleDoc} saath lekar aana hoga. 👍\n\n${candidate.interviewDateTime ? `Aapka interview already confirmed hai for: *${interviewFormatted}*.` : (candidate.resumeReceived ? `👉 Kya aap kal morning me *10:00 AM se 12:00 PM* ke beech hamare Indore office (*103 Orange Business Park, Bhawarkua*) interview ke liye aa sakte hain? 🏢` : `👉 Kripya batayein aap kis position ke liye apply karna chahte hain?`)}`;
    } else {
      return `${prefixEn}📌 *Documents Required:*\nPlease bring your updated *Resume (Hard Copy/PDF)* and ${roleDoc} with you for the interview. 👍\n\n${candidate.interviewDateTime ? `Your interview is confirmed for: *${interviewFormatted}*.` : (candidate.resumeReceived ? `👉 Are you available to visit our Indore office tomorrow morning between *10:00 AM and 12:00 PM*? 🏢` : `👉 Which position would you like to apply for?`)}`;
    }
  }

  // ── STEP 1: CANDIDATE HAS NOT SELECTED A ROLE YET (Or requested fresh start) ──
  if (!candidate.role || candidate.role === 'General Applicant') {
    if (isHinglish) {
      return `${prefixHi}Brand Setu Digital me aapka swagat hai! 🎉\n\nHum Indore office ke liye in 6 active roles par hiring kar rahe hain:\n1️⃣ 🎬 *Video Editor*\n2️⃣ 🤖 *AI Video Expert*\n3️⃣ 🎨 *Graphic Designer*\n4️⃣ 🔎 *SEO & AEO Expert*\n5️⃣ 📱 *Social Media Manager*\n6️⃣ 📢 *Digital Marketing Manager*\n\n👉 Aap **kis position/role** ke liye apply karna chahte hain? (1 to 6 number ya role ka naam likhein) 📝`;
    } else {
      return `${prefixEn}Welcome to Brand Setu Digital! 🎉\n\nWe are actively hiring for these 6 positions at our Indore office:\n1️⃣ 🎬 *Video Editor*\n2️⃣ 🤖 *AI Video Expert*\n3️⃣ 🎨 *Graphic Designer*\n4️⃣ 🔎 *SEO & AEO Expert*\n5️⃣ 📱 *Social Media Manager*\n6️⃣ 📢 *Digital Marketing Manager*\n\n👉 Which **position/role** would you like to apply for? (Please reply with number 1 to 6 or the role name) 📝`;
    }
  }

  // ── STEP 2: ROLE IS SELECTED, BUT EXPERIENCE / FRESHER STATUS NOT PROVIDED YET ──
  if (!candidate.experience || candidate.experience === '') {
    if (isHinglish) {
      return `Bahut badiya! Aapne *${candidate.role}* select kiya hai. 👍\n\nKripya batayein:\n1️⃣ Aap *Fresher (Paid Internship)* ke liye apply kar rahe hain ya *Experienced (Full-Time Role)* ke liye?\n2️⃣ Agar experienced hain, to aapko kitne time (months/years) ka experience hai? 💼`;
    } else {
      return `Great! You have selected *${candidate.role}*. 👍\n\nPlease let us know:\n1️⃣ Are you applying as a *Fresher (Paid Internship)* or *Experienced (Full-Time Role)*?\n2️⃣ If experienced, how many months/years of experience do you have? 💼`;
    }
  }

  // ── STEP 3: EXPERIENCE PROVIDED, BUT RESUME / PORTFOLIO PENDING ──
  if (!candidate.resumeReceived) {
    if (candidate.role === 'AI Video Expert') {
      return isHinglish
        ? `${prefixHi}Awesome! 🤖 Kripya apna updated *Resume (PDF)* aur AI video tools (Runway, Midjourney, Kling, Pika, etc.) ke samples ka *Google Drive link* yahan share karein. 📄🎥`
        : `${prefixEn}Awesome! 🤖 Please share your updated *Resume (PDF)* and your AI video work samples / Google Drive link here. 📄🎥`;
    } else if (candidate.role === 'Graphic Designer') {
      return isHinglish
        ? `${prefixHi}Perfect! 🎨 Kripya apna updated *Resume (PDF)* aur *Design Portfolio link (Behance / Drive / Figma)* yahan share karein. 📄🎨`
        : `${prefixEn}Perfect! 🎨 Please share your updated *Resume (PDF)* and your *Design Portfolio (Behance / Drive / Figma link)* here. 📄🎨`;
    } else if (candidate.role === 'SEO & AEO Expert') {
      return isHinglish
        ? `${prefixHi}Great! 🔎 Kripya apna updated *Resume (PDF)* aur live SEO rankings / case studies details yahan share karein. 📄📊`
        : `${prefixEn}Great! 🔎 Please share your updated *Resume (PDF)* and your live SEO rankings / case studies proof here. 📄📊`;
    } else if (candidate.role === 'Social Media Manager') {
      return isHinglish
        ? `${prefixHi}Super! 📱 Kripya apna updated *Resume (PDF)* aur past managed social media profiles / growth proof share karein. 📄🚀`
        : `${prefixEn}Super! 📱 Please share your updated *Resume (PDF)* and your past managed social media profiles / growth proof here. 📄🚀`;
    } else if (candidate.role === 'Digital Marketing Manager') {
      return isHinglish
        ? `${prefixHi}Excellent! 📢 Kripya apna updated *Resume (PDF)* aur Ad campaign / ROAS case studies yahan share karein. 📄💼`
        : `${prefixEn}Excellent! 📢 Please share your updated *Resume (PDF)* and your Ad campaign / ROAS case studies here. 📄💼`;
    } else {
      return isHinglish
        ? `${prefixHi}Bahut badiya! 🎬 Kripya apna updated *Resume (PDF)* aur Video Editing ka *Portfolio / Google Drive link* yahan share karein taaki hum aapka in-person practical interview schedule kar sakein. 📄🎥`
        : `${prefixEn}Great! 🎬 Please share your updated *Resume (PDF)* and your Video Portfolio / Google Drive link here so we can schedule your interview. 📄🎥`;
    }
  }

  // ── STEP 4: RESUME / PORTFOLIO RECEIVED (Immediate acknowledgment, HR review) ──
  if (candidate.resumeReceived && !candidate.interviewDateTime) {
    if (isHinglish) {
      return `${prefixHi}Aapka Resume / Portfolio receive ho gaya hai, dhanyawad! 📄✨\n\nHamari HR team aapki profile aur work samples ko review kar rahi hai. Hum jald hi aage ke process ke liye aapse connect karenge! 👍`;
    } else {
      return `${prefixEn}Thank you for sharing your resume/portfolio! 📄✨\n\nOur HR team is currently reviewing your profile and work samples. We will connect with you shortly for the next steps! 👍`;
    }
  }

  // ── STEP 5: INTERVIEW ALREADY CONFIRMED (Default fallback) ──
  if (candidate.interviewDateTime) {
    const isOnline = candidate.interviewMode === 'online';
    if (isHinglish) {
      return isOnline
        ? `Aapka Online Google Meet interview *${interviewFormatted}* ke liye confirmed hai. Interview start hone se *15 minute pehle* link share kar di jayegi. All the best! 💻✨`
        : `Aapka in-person interview *${interviewFormatted}* ke liye confirmed hai at 103 Orange Business Park, Bhawarkua, Indore. Please arrive on time with your updated Resume. All the best! 😊📍`;
    } else {
      return isOnline
        ? `Your Online Google Meet interview is confirmed for *${interviewFormatted}*. You will receive the joining link 15 minutes prior. All the best! 💻✨`
        : `Your in-person interview is confirmed for *${interviewFormatted}* at 103 Orange Business Park, Bhawarkua, Indore. Please arrive on time with your updated Resume. All the best! 😊📍`;
    }
  }
}

function cleanAiResponseText(rawText) {
  if (!rawText) return '';
  let text = rawText.trim();
  text = text.replace(/^```(?:markdown|json|text)?\s*/i, '').replace(/```\s*$/i, '').trim();
  text = text.replace(/^(?:Direct\s*WhatsApp\s*Message|HR\s*Assistant\s*Reply|Reply):\s*/i, '').trim();
  if (text.includes('STRICT LANGUAGE DIRECTIVE') || text.includes('STRICT STEP-BY-STEP') || text.includes('COMPANY INFORMATION') || text.includes('CANDIDATE PROFILE')) {
    return '';
  }
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
  candName = candName.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '');
  candName = candName.replace(/[^a-zA-Z\s\u0900-\u097F]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!candName || candName.length < 2 || ['candidate', 'customer', 'user', 'allhumdullillha', 'alhamdulillah', 'allah', 'sunshine', 'admin', 'brandsetu', 'snacks'].some(b => candName.toLowerCase().includes(b))) {
    candName = 'Candidate';
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

  // 0. Check off-topic before invoking Gemini or Fallback
  if (isOffTopicMessage(userMessage, candidate)) {
    console.log(`⚠️ Off-topic message intercepted from ${candidateSummary.name} (+${candidate.phone}): "${userMessage}"`);
    return getOffTopicBoundaryResponse(lang);
  }

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

CRITICAL CONVERSATIONAL & GREETING RULES (MANDATORY):
1. NO REPETITIVE GREETINGS: Do NOT start every single message with "Hello [Name]!" or "Namaste [Name]!". In ongoing conversation, speak naturally, politely, and directly like a human HR without repeating their name on every message.
2. GREET ONLY ON INITIAL TURN: Only greet by name (e.g. "Hello Arjun!" or "Namaste Arjun!") on the VERY FIRST message of the chat or if candidate explicitly sends an initial greeting (Hi/Hello).
3. Candidate's Detected Language: ${lang.toUpperCase()}
   - If candidate wrote in ENGLISH: Reply 100% in fluent, professional ENGLISH.
   - If candidate wrote in HINDI / HINGLISH: Reply in natural, polite HINGLISH.
4. RESUME FORMAT REQUIREMENT: Resume MUST be in PDF format (.pdf). If candidate sends images/photos or asks about resume, remind them that only PDF resumes are accepted.
5. PORTFOLIO FORMAT REQUIREMENT: Portfolio / work samples must be shared as a valid link (Google Drive, Behance, Figma, YouTube link).
6. OFF-TOPIC MESSAGES: If the user message is irrelevant to hiring or job positions (e.g. casual chit-chat, personal questions, songs, jokes, loans, weather), politely remind them that this helpline is strictly for BrandSetu Digital recruitment.

STRICT STEP-BY-STEP RECRUITMENT FUNNEL INSTRUCTIONS:
Follow these 5 sequential qualification steps strictly:

👉 STEP 1 (If candidate has NOT chosen a role yet):
Present the 6 active openings:
1. Video Editor
2. AI Video Expert
3. Graphic Designer
4. SEO & AEO Expert
5. Social Media Manager
6. Digital Marketing Manager
Ask which position (1 to 6) they want to apply for.

👉 STEP 2 (If role is chosen, but Experience / Fresher status is not known yet):
Acknowledge the chosen role and ask:
1. Are they applying as a Fresher (Paid Internship) or Experienced (Full-Time)?
2. If experienced, how many months/years of experience do they have?

👉 STEP 3 (If role & experience are known, but Resume / Portfolio is pending):
Ask for their updated Resume (PDF) + role-specific work samples / portfolio / Google Drive link based on the job requirements.

👉 STEP 4 (If Resume / Portfolio has just been received, but not reviewed yet):
- Acknowledge receipt warmly and inform that HR is reviewing:
  - English: "Thank you for sharing your resume/portfolio! 📄✨ Our HR team is reviewing your profile and work samples. We will connect with you shortly for the next steps! 👍"
  - Hinglish: "Aapka Resume / Portfolio receive ho gaya hai, dhanyawad! 📄✨ Hamari HR team aapki profile aur work samples ko review kar rahi hai. Hum jald hi aage ke process ke liye aapse connect karenge! 👍"
- If candidate says NO / Cannot come / Busy for interview:
  - English: "No problem! Please share your preferred Date and Time (Monday to Saturday, 10:00 AM to 6:00 PM) when you can visit for the interview."
  - Hinglish: "Koi baat nahi! Aap apni suvidha ke anusaar preferred Date aur Time bata dijiye (Monday to Saturday, 10:00 AM se 6:00 PM ke beech) kab aap interview ke liye aa sakte hain? 📅"

👉 STEP 5 (If interview is ALREADY scheduled and confirmed):
- If candidate sends simple acknowledgment ("ok", "thik h", "haa thik h", "hmm", "done", "yes", "sure", "thanks", "acha"):
  Reply with a SHORT, friendly closing acknowledgment (e.g. English: "Great! See you at the interview. 👍 All the best! 😊" | Hinglish: "Bahut badiya! Interview me milte hain. 👍 All the best! 😊").
  DO NOT repeat the entire interview confirmation paragraph or address/time, and DO NOT reschedule!
- If candidate says they are coming / on the way ("aa raha hu", "gate par hu", "reception"):
  Welcome them warmly and tell them to check in at the reception (103 Orange Business Park, Bhawarkua).
- If candidate asks a specific question (documents to bring, directions, salary, JD):
  Answer ONLY that specific question concisely.
- NEVER reschedule unless the candidate explicitly gives a new specific time/day to reschedule.

- If candidate says "Not interested", "nhi chahiye", "no need", "not looking", "drop", "cancel", "nahi aana": Politely thank them and close the conversation with best wishes. DO NOT offer an interview or provide office address!
- If candidate asks about Job Description (JD) / Work / Responsibilities: Share the clear, concise job description for their specific applied role (tailored for Fresher Internship or Experienced Full-Time).
- If candidate asks about Stipend / Salary: Explain clearly that salary/stipend is decided based on candidate's experience, skills, and in-person practical assessment, and will be finalized and communicated during the in-person interview. (Hinglish: "Hamare yahan salary/stipend aapke experience, skills aur in-person interview ke basis par decide hoti hai aur interview me bata di jayegi." | English: "Salary/stipend is decided based on your experience, skills, and in-person interview, and will be finalized during the interview.").
- If candidate asks about Location / WFH: Explain that this is strictly Onsite In-Office at 103 Orange Business Park, Bhawarkua, Indore.
- OUTPUT ONLY the direct WhatsApp reply. No thinking, no extra notes.

Direct WhatsApp Message:
`;

  // 1. Call Gemini AI with active modern models
  if (rawKey && rawKey.trim() !== '') {
    try {
      const result = await callGeminiApi(prompt, rawKey, { temperature: 0.6, maxTokens: 3000 });
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
      const result = await callGeminiApi(prompt, rawKey, { temperature: 0.65, maxTokens: 3000 });
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
  isNotInterestedMessage,
  isAcknowledgementMessage,
  isOffTopicMessage,
  isPartTimeQuery,
  isAdInquiryMessage,
  isGreetingMessage,
  isDocumentQuery,
  isArrivalStatusMessage,
  getOffTopicBoundaryResponse,
  getOffTopicWarningResponse,
  detectLanguage
};
