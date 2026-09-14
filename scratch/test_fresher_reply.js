const aiService = require('../services/ai.service');

async function testFresherSelection() {
  const candidate = {
    name: 'Aniket Sharma',
    phone: '918103743283',
    role: 'Video Editor',
    lang: 'english',
    chatHistory: [
      { role: 'user', text: 'Video Editor' },
      { role: 'assistant', text: 'Great! Are you applying as Fresher (Paid Internship) or Experienced (Full-Time Role)?' }
    ]
  };

  console.log('Testing: "Fresher (Paid Internship)"...');
  const reply = await aiService.generateHiringAIResponse(candidate, 'Fresher');
  console.log('\n================ FULL BOT REPLY ================');
  console.log(reply);
  console.log('================ END OF REPLY ==================\n');
}

testFresherSelection().catch(console.error);
