require('dotenv').config();
const aiService = require('../services/ai.service');

async function testConversationFixes() {
  console.log('🧪 Testing Candidate Conversation Fixes...\n');

  // Candidate with confirmed interview
  const candidate = {
    id: 'test_cand_1',
    name: 'Arjun Meena',
    phone: '919876543210',
    role: 'Graphic Designer',
    experience: 'Fresher (Paid Internship)',
    resumeReceived: true,
    interviewDateTime: '2026-09-07T11:00:00+05:30',
    interviewMode: 'in_person',
    status: 'Interview Scheduled',
    chatHistory: [
      { role: 'assistant', text: 'Dear Arjun! Your in-person interview for Graphic Designer has been scheduled for Mon, 7 Sept, 11:00 am at 103 Orange Business Park, Bhawarkua, Indore.' }
    ]
  };

  const testCases = [
    { message: 'Thik h', expectedReschedule: false },
    { message: 'Haa thik h', expectedReschedule: false },
    { message: 'Hmm', expectedReschedule: false },
    { message: 'ok', expectedReschedule: false },
    { message: 'ok sir done', expectedReschedule: false },
    { message: 'acha', expectedReschedule: false },
    { message: 'Yes a rha hun', expectedReschedule: false },
    { message: 'Hiiii', expectedReschedule: false },
    { message: 'Location share kre office ki', expectedReschedule: false },
    { message: 'kya documents lane hain?', expectedReschedule: false },
    { message: 'Today 5:30 baje mera interview reschedule kar do', expectedReschedule: true }
  ];

  let passedAll = true;

  for (const tc of testCases) {
    console.log(`\n--------------------------------------------------`);
    console.log(`💬 Incoming Candidate Message: "${tc.message}"`);
    
    // 1. Schedule Detection Check
    const schedIntent = await aiService.parseInterviewScheduleWithGemini(tc.message, candidate);
    const isRescheduling = !!(schedIntent && schedIntent.isScheduling);
    console.log(`📅 Is Rescheduling Triggered?: ${isRescheduling} (Expected: ${tc.expectedReschedule})`);

    if (isRescheduling !== tc.expectedReschedule) {
      console.error(`❌ FAILED: Reschedule check mismatch for "${tc.message}"!`);
      passedAll = false;
    } else {
      console.log(`✅ PASSED: Reschedule detection correct`);
    }

    // 2. Fallback / AI Response Check
    const reply = await aiService.generateHiringAIResponse(candidate, tc.message, { messageType: 'text' });
    console.log(`🤖 Bot Reply:\n${reply}`);

    // Check that reply does not spam full duplicate address for simple ack
    if (['Thik h', 'Haa thik h', 'Hmm', 'ok', 'acha'].includes(tc.message)) {
      if (reply.includes('103 Orange Business Park') || reply.includes('already confirmed hai for')) {
        console.error(`❌ FAILED: Reply spammed full confirmation/address for simple ack "${tc.message}"!`);
        passedAll = false;
      } else {
        console.log(`✅ PASSED: Short friendly acknowledgement reply`);
      }
    }
  }

  console.log(`\n==================================================`);
  if (passedAll) {
    console.log(`🎉 ALL TEST CASES PASSED SUCCESSFULLY!`);
  } else {
    console.log(`⚠️ SOME TEST CASES FAILED. CHECK LOGS ABOVE.`);
  }
}

testConversationFixes();
