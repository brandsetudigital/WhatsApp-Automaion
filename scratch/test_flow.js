require('dotenv').config();
const aiService = require('../services/ai.service');
const hiringService = require('../services/hiring.service');

async function runSimulation() {
  console.log('=====================================================');
  console.log('🚀 STARTING FULL HIRING CONVERSATION SIMULATION');
  console.log('=====================================================\n');

  const testPhone = '919876543210';
  
  // Step 1: Candidate says "Hii"
  console.log('👤 [Candidate]: Hii');
  let cand = hiringService.trackCandidateFromMessage({
    customerPhone: testPhone,
    customerName: 'Arjun Meena',
    messageText: 'Hii',
    messageType: 'text'
  });
  let reply1 = await aiService.generateHiringAIResponse(cand, 'Hii', { messageType: 'text' });
  hiringService.appendChatHistory(cand, 'assistant', reply1);
  console.log(`🤖 [BrandSetu AI]:\n${reply1}\n`);

  // Step 2: Candidate chooses role "SEO expert"
  console.log('👤 [Candidate]: SEO expert');
  cand = hiringService.trackCandidateFromMessage({
    customerPhone: testPhone,
    customerName: 'Arjun Meena',
    messageText: 'SEO expert',
    messageType: 'text'
  });
  let reply2 = await aiService.generateHiringAIResponse(cand, 'SEO expert', { messageType: 'text' });
  hiringService.appendChatHistory(cand, 'assistant', reply2);
  console.log(`🤖 [BrandSetu AI]:\n${reply2}\n`);

  // Step 3: Candidate sends Resume (document)
  console.log('👤 [Candidate]: [Document: Arjun_Meena_Resume.pdf]');
  cand = hiringService.trackCandidateFromMessage({
    customerPhone: testPhone,
    customerName: 'Arjun Meena',
    messageText: 'Arjun_Meena_Resume.pdf',
    messageType: 'document'
  });
  let reply3 = await aiService.generateHiringAIResponse(cand, 'Arjun_Meena_Resume.pdf', { messageType: 'document' });
  hiringService.appendChatHistory(cand, 'assistant', reply3);
  console.log(`🤖 [BrandSetu AI]:\n${reply3}\n`);

  // Step 4: Candidate provides interview availability "Tomorrow at 3:00 PM"
  console.log('👤 [Candidate]: I can come tomorrow at 3 PM for the interview');
  cand = hiringService.trackCandidateFromMessage({
    customerPhone: testPhone,
    customerName: 'Arjun Meena',
    messageText: 'I can come tomorrow at 3 PM for the interview',
    messageType: 'text'
  });

  const scheduleIntent = await aiService.parseInterviewScheduleWithGemini('I can come tomorrow at 3 PM for the interview', cand);
  console.log('🔍 Schedule Intent Detected:', scheduleIntent);

  if (scheduleIntent && scheduleIntent.isScheduling) {
    const updated = await hiringService.scheduleInterview(
      cand.id,
      scheduleIntent.proposedDateTimeIso,
      cand.role,
      'Simulation scheduled',
      false // Don't actually send real WhatsApp network request in unit test
    );
    console.log(`✅ Candidate Interview Scheduled in CRM & Excel at: ${updated.interviewDateTime}`);
    console.log(`✅ Status: ${updated.status}`);
  }

  // Step 5: Candidate asks about salary
  console.log('\n👤 [Candidate]: What will be my salary?');
  cand = hiringService.trackCandidateFromMessage({
    customerPhone: testPhone,
    customerName: 'Arjun Meena',
    messageText: 'What will be my salary?',
    messageType: 'text'
  });
  let reply5 = await aiService.generateHiringAIResponse(cand, 'What will be my salary?', { messageType: 'text' });
  console.log(`🤖 [BrandSetu AI]:\n${reply5}\n`);

  console.log('=====================================================');
  console.log('🎉 SIMULATION COMPLETED SUCCESSFULLY!');
  console.log('=====================================================');
}

runSimulation();
