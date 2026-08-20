const axios = require('axios');
require('dotenv').config();

const key = process.env.GEMINI_API_KEY;

async function testGeneration() {
  const models = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const res = await axios.post(url, {
        contents: [{ parts: [{ text: 'Reply in English: Acknowledge candidate applying for SEO Expert role at BrandSetu Digital and ask for their updated resume.' }] }]
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      console.log(`✅ [${model}] Output:`);
      console.log(res.data?.candidates?.[0]?.content?.parts?.[0]?.text);
      return;
    } catch (e) {
      console.log(`❌ [${model}] error:`, e.response?.data?.error?.message || e.message);
    }
  }
}

testGeneration();
