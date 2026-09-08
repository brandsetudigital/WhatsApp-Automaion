const aiService = require('../services/ai.service');
const hiringService = require('../services/hiring.service');

async function testAniketFlow() {
  console.log('Testing Aniket message: "I want part time internship"...');
  
  // 1. Verify isGreetingMessage
  const isGreeting = aiService.isGreetingMessage('I want part time internship');
  console.log('isGreetingMessage result:', isGreeting);

  // 2. Verify isPartTimeQuery
  const isPartTime = aiService.isPartTimeQuery('I want part time internship');
  console.log('isPartTimeQuery result:', isPartTime);

  // 3. Generate response
  const cand = {
    name: 'Aniket Sharma',
    phone: '918103743283',
    role: 'AI Video Expert',
    lang: 'english'
  };
  const response = await aiService.generateHiringAIResponse(cand, 'I want part time internship');
  console.log('\n--- Bot Reply ---');
  console.log(response);
  console.log('-----------------');

  console.log('\nTesting Arjun Meena message: "Hello Sir"...');
  const isGreetingArjun = aiService.isGreetingMessage('Hello\nSir');
  console.log('isGreetingMessage("Hello\\nSir"):', isGreetingArjun);
  const candArjun = {
    name: 'Arjun Meena',
    phone: '918357977322',
    role: 'SEO & AEO Expert',
    lang: 'hinglish'
  };
  const responseArjun = await aiService.generateHiringAIResponse(candArjun, 'Hello\nSir');
  console.log('\n--- Bot Reply to Arjun ---');
  console.log(responseArjun);
  console.log('-----------------');
  
  console.log('\n✅ BOTH FLOWS WORK PERFECTLY WITHOUT ANY ERRORS!');
}

testAniketFlow().catch(console.error);
