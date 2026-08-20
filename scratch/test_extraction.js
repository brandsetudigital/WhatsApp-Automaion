const axios = require('axios');
require('dotenv').config();

const key = process.env.GEMINI_API_KEY;

async function testExtractionHinglish() {
  const currentIso = new Date().toISOString();
  const prompt = `
You are an intelligent HR assistant.
Current Date & Time: ${currentIso} (Timezone: Asia/Kolkata, UTC+5:30)

Candidate was asked for their interview availability.
Candidate replied: "Kal dopahar 2 baje aa sakta hu"

Task:
1. Determine if candidate is proposing a date/time for interview.
2. If yes, convert the proposed interview date & time into ISO-8601 format (Asia/Kolkata offset +05:30).
3. Return ONLY valid JSON in format:
{
  "isScheduling": true,
  "proposedDateTimeIso": "YYYY-MM-DDTHH:mm:ss+05:30",
  "readableTime": "Tomorrow at 2:00 PM"
}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
    const res = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    }, { timeout: 10000 });

    console.log('Output Hinglish JSON:', res.data?.candidates?.[0]?.content?.parts?.[0]?.text);
  } catch (e) {
    console.error('Error:', e.response?.data || e.message);
  }
}

testExtractionHinglish();
