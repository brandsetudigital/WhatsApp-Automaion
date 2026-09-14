const hiringService = require('../services/hiring.service');
const aiService = require('../services/ai.service');

async function runTests() {
  console.log('🧪 Starting Automated Verification of Enhanced Hiring & Influencer Flow...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Welcome Message
  const welcomeHi = hiringService.getWelcomeRolesReply('hinglish');
  const welcomeEn = hiringService.getWelcomeRolesReply('english');
  assert(welcomeHi.includes('Video Editor') && welcomeHi.includes('Influencer Collaboration') && welcomeHi.includes('Freelancer') && welcomeHi.includes('Work From Home') && welcomeHi.includes('Part-Time'), 'Welcome (Hinglish) contains all roles, work modes (WFH, Freelance, Part-Time) & Influencer');
  assert(welcomeEn.includes('Video Editor') && welcomeEn.includes('Influencer Collaboration') && welcomeEn.includes('Freelancer') && welcomeEn.includes('Work From Home') && welcomeEn.includes('Part-Time'), 'Welcome (English) contains all roles, work modes & Influencer');

  // 2. Video Editor Role Selected
  const videoEditorReply = hiringService.getRoleSelectedReply('Video Editor', 'hinglish');
  assert(videoEditorReply.includes('Premiere Pro') && videoEditorReply.includes('Reels') && (videoEditorReply.includes('Work From Home') || videoEditorReply.includes('Freelancer')), 'Video Editor selection asks software, video style (Reels/Ads), and work mode');

  // 3. Influencer Collaboration Selected
  const influencerReply = hiringService.getRoleSelectedReply('Influencer Collaboration', 'hinglish');
  assert(influencerReply.includes('Influencer Collaboration! ✨') &&
         influencerReply.includes('We’d love to know a little more about you and your content before taking the collaboration forward') &&
         influencerReply.includes('Instagram / YouTube profile') &&
         influencerReply.includes('followers'), 'Influencer Collaboration selection sends required onboarding message & questions');

  // 4. Other Digital Marketing Role Selected
  const contentWriterReply = hiringService.getRoleSelectedReply('Content Writer', 'hinglish');
  assert(!contentWriterReply.includes('hiring nahi') && contentWriterReply.includes('Content Writer') && (contentWriterReply.includes('Freelancer') || contentWriterReply.includes('Work From Home')), 'Other Digital Marketing role (Content Writer) is accepted with tailored questions');

  // 5. Query: Work From Home (WFH)
  const testCandWfh = { id: 'test_wfh_1', name: 'Rohan', phone: '919999900001', role: 'General Applicant', status: 'Applied', chatHistory: [] };
  const wfhReply = await aiService.generateHiringAIResponse(testCandWfh, 'Can I do work from home? Ghar se kaam karna hai');
  assert(!wfhReply.includes('Remote ya Work-From-Home option available nahi hai') &&
         (wfhReply.includes('Work From Home') || wfhReply.includes('WFH') || wfhReply.includes('Resume')), 'WFH query is welcomed and NOT refused');

  // 6. Query: Part-Time / Freelancer
  const testCandPt = { id: 'test_pt_1', name: 'Pooja', phone: '919999900002', role: 'General Applicant', status: 'Applied', chatHistory: [] };
  const ptReply = await aiService.generateHiringAIResponse(testCandPt, 'I am looking for part time 3 hours daily or freelance');
  assert(!ptReply.includes('Filhal 2-3 ghante ya Part-Time option available nahi hai') &&
         (ptReply.includes('Part-Time') || ptReply.includes('Freelancer') || ptReply.includes('hours') || ptReply.includes('Resume')), 'Part-Time / Freelance query is welcomed and NOT refused');

  // 7. Query: Web Developer / Other Digital Marketing Role (No rejection)
  const testCandWeb = { id: 'test_web_1', name: 'Amit', phone: '919999900003', role: 'General Applicant', status: 'Applied', chatHistory: [] };
  const webReply = await aiService.generateHiringAIResponse(testCandWeb, 'Mujhe website development aur WordPress ka role chahiye');
  assert(!webReply.includes('vacancy open nahi hai') && (webReply.includes('Web') || webReply.includes('Developer') || webReply.includes('Resume')), 'Web Developer inquiry is NOT rejected with "vacancy open nahi hai"');

  // 8. Candidate Tracking: Freelancer + Video Editor
  const trackedCand1 = hiringService.trackCandidateFromMessage({
    customerPhone: '919876543210',
    messageText: 'Hi I am Rahul, I want to apply for video editor freelance work from home',
    messageType: 'text'
  });
  assert(trackedCand1.role === 'Video Editor', 'Candidate 1 role tracked as Video Editor');
  assert(trackedCand1.workType === 'Freelancer' || trackedCand1.workType === 'Work From Home', 'Candidate 1 workType tracked as Freelancer/WFH');

  // 9. Candidate Tracking: Influencer Collaboration
  const trackedCand2 = hiringService.trackCandidateFromMessage({
    customerPhone: '919876543211',
    messageText: 'Hello, I want to connect for Influencer Collaboration. My instagram is @tech_creator with 45k followers',
    messageType: 'text'
  });
  assert(trackedCand2.role === 'Influencer Collaboration', 'Candidate 2 tracked as Influencer Collaboration');
  assert(trackedCand2.socialHandle && trackedCand2.socialHandle.includes('tech_creator'), 'Candidate 2 socialHandle captured');
  assert(trackedCand2.followers && trackedCand2.followers.includes('45k'), 'Candidate 2 follower count captured');

  console.log(`\n📊 Results: ${passed} Passed, ${failed} Failed`);
  if (failed === 0) {
    console.log('🎉 All enhanced hiring, influencer, and work mode features verified successfully!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
