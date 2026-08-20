require('dotenv').config();
const aiService = require('../services/ai.service');

async function testIntent() {
  const msg1 = "I can come tomorrow at 3 PM for the interview";
  const res1 = await aiService.parseInterviewScheduleWithGemini(msg1);
  console.log('Result for English:', res1);

  const msg2 = "Kal dopahar 2 baje aa sakta hu";
  const res2 = await aiService.parseInterviewScheduleWithGemini(msg2);
  console.log('Result for Hinglish:', res2);
}

testIntent();
