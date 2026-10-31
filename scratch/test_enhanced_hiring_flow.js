const hiringService = require('../services/hiring.service');
const aiService = require('../services/ai.service');

async function runTests() {
  console.log('🧪 Starting Automated Verification of Welcome Message & Field Marketing Role...\n');
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

  // 1. Welcome Message Verification (Exact text requested by user)
  const welcomeHi = hiringService.getWelcomeRolesReply('hinglish');
  const welcomeEn = hiringService.getWelcomeRolesReply('english');
  const expectedWelcomeStart = '🎉 Welcome to BrandSetu Digital!';
  const expectedWelcomeUrl = 'https://brandsetudigital.com';
  const expectedTeam = '**Team BrandSetu Digital** 🌐';
  const expectedOpportunities = 'Opportunities are available for Freshers, Experienced Professionals, Interns & Freelancers.';
  const expectedQuestion = '👉 **Which position or role would you like to apply for?**';

  assert(welcomeHi.includes(expectedWelcomeStart), 'Welcome (Hinglish) starts with "🎉 Welcome to BrandSetu Digital!"');
  assert(welcomeHi.includes(expectedOpportunities), 'Welcome (Hinglish) mentions Freshers, Experienced Professionals, Interns & Freelancers');
  assert(welcomeHi.includes(expectedQuestion), 'Welcome (Hinglish) includes role inquiry');
  assert(welcomeHi.includes(expectedTeam) && welcomeHi.includes(expectedWelcomeUrl), 'Welcome (Hinglish) has Team footer and website URL');

  assert(welcomeEn.includes(expectedWelcomeStart), 'Welcome (English) starts with "🎉 Welcome to BrandSetu Digital!"');
  assert(welcomeEn.includes(expectedOpportunities), 'Welcome (English) mentions Freshers, Experienced Professionals, Interns & Freelancers');
  assert(welcomeEn.includes(expectedQuestion), 'Welcome (English) includes role inquiry');
  assert(welcomeEn.includes(expectedTeam) && welcomeEn.includes(expectedWelcomeUrl), 'Welcome (English) has Team footer and website URL');

  // 2. Field Marketing & Lead Generation - Role Selection Reply
  const fmSelectedReplyHi = hiringService.getRoleSelectedReply('Field Marketing & Lead Generation', 'hinglish');
  assert(fmSelectedReplyHi.includes('Field Marketing & Lead Generation') &&
         fmSelectedReplyHi.includes('two-wheeler') &&
         fmSelectedReplyHi.includes('experience'), 'Field Marketing selection (Hinglish) asks experience, two-wheeler/bike, and communication');

  const fmSelectedReplyEn = hiringService.getRoleSelectedReply('Field Marketing & Lead Generation', 'english');
  assert(fmSelectedReplyEn.includes('Field Marketing & Lead Generation') &&
         fmSelectedReplyEn.includes('two-wheeler') &&
         fmSelectedReplyEn.includes('experience'), 'Field Marketing selection (English) asks experience, two-wheeler/bike, and skills');

  // 3. Field Marketing & Lead Generation - Experience Answered Reply
  const fmCandidate = { id: 'test_fm_1', name: 'Vikram Sharma', phone: '919876543299', role: 'Field Marketing & Lead Generation', experience: '1 Year Field Sales' };
  const fmExpReply = hiringService.getExperienceAnsweredReply(fmCandidate, 'hinglish');
  assert(fmExpReply.includes('Resume (PDF)') && fmExpReply.includes('Vikram'), 'Field Marketing experience reply requests updated PDF resume with candidate name');

  // 4. Candidate Tracking: Field Marketing & Lead Generation
  const trackedCandFm1 = hiringService.trackCandidateFromMessage({
    customerPhone: '919876543291',
    messageText: 'Hello sir, I want to apply for Field Marketing & Lead Generation',
    messageType: 'text'
  });
  assert(trackedCandFm1.role === 'Field Marketing & Lead Generation', 'Candidate message "Field Marketing & Lead Generation" correctly tracks role');

  const trackedCandFm2 = hiringService.trackCandidateFromMessage({
    customerPhone: '919876543292',
    messageText: 'mujhe lead generation aur field marketing ki job karni hai',
    messageType: 'text'
  });
  assert(trackedCandFm2.role === 'Field Marketing & Lead Generation', 'Candidate message with "lead generation aur field marketing" correctly tracks role');

  const trackedCandFm3 = hiringService.trackCandidateFromMessage({
    customerPhone: '919876543293',
    messageText: 'I have 1 year experience in BDE and field sales',
    messageType: 'text'
  });
  assert(trackedCandFm3.role === 'Field Marketing & Lead Generation', 'Candidate mentioning "BDE and field sales" correctly tracks Field Marketing & Lead Generation');

  // 5. Video Editor Role Selected
  const videoEditorReply = hiringService.getRoleSelectedReply('Video Editor', 'hinglish');
  assert(videoEditorReply.includes('Premiere Pro') && videoEditorReply.includes('Reels'), 'Video Editor selection asks software and video style');

  // 6. Influencer Collaboration Selected
  const influencerReply = hiringService.getRoleSelectedReply('Influencer Collaboration', 'hinglish');
  assert(influencerReply.includes('Influencer Collaboration! ✨') &&
         influencerReply.includes('Instagram / YouTube profile') &&
         influencerReply.includes('followers'), 'Influencer Collaboration selection sends required onboarding message & questions');

  // 7. Query: Work From Home (WFH)
  const testCandWfh = { id: 'test_wfh_1', name: 'Rohan', phone: '919999900001', role: 'General Applicant', status: 'Applied', chatHistory: [] };
  const wfhReply = await aiService.generateHiringAIResponse(testCandWfh, 'Can I do work from home? Ghar se kaam karna hai');
  assert(!wfhReply.includes('Remote ya Work-From-Home option available nahi hai') &&
         (wfhReply.includes('Work From Home') || wfhReply.includes('WFH') || wfhReply.includes('Resume')), 'WFH query is welcomed and NOT refused');

  // 8. Query: Field Marketing Job Description
  const fmJdReply = await aiService.generateHiringAIResponse(
    { id: 'test_fm_jd', name: 'Aakash', phone: '919999900009', role: 'Field Marketing & Lead Generation', status: 'Applied', chatHistory: [] },
    'Field marketing me kaam kya karna padega? Job description batao'
  );
  assert(fmJdReply.includes('Field Marketing') || fmJdReply.includes('Lead Generation') || fmJdReply.includes('Indore'), 'Field Marketing JD query returns specific job details');

  console.log(`\n📊 Results: ${passed} Passed, ${failed} Failed`);
  if (failed === 0) {
    console.log('🎉 All welcome message and Field Marketing & Lead Generation features verified successfully!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
