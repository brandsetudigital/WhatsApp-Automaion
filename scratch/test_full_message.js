const aiService = require('../services/ai.service');

async function testFullMessage() {
  const candidate = {
    name: 'Aniket Sharma',
    phone: '918103743283',
    role: 'Video Editor',
    experience: 'Fresher (Paid Internship)',
    lang: 'english',
    chatHistory: [
      { role: 'user', text: 'Video Editor' },
      { role: 'assistant', text: 'Great! Are you applying as Fresher or Experienced?' },
      { role: 'user', text: 'Fresher' }
    ]
  };

  console.log('Testing: "Plz share freshers intership details"...');
  const reply = await aiService.generateHiringAIResponse(candidate, 'Plz share freshers intership details');
  console.log('\n================ FULL BOT REPLY ================');
  console.log(reply);
  console.log('================ END OF REPLY ==================\n');
  console.log('Character length:', reply.length);
  
  // Verify that message does not end abruptly
  const lastChar = reply.trim().slice(-1);
  console.log('Last character:', lastChar);
}

testFullMessage().catch(console.error);
