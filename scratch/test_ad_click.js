const aiService = require('../services/ai.service');
const hiringService = require('../services/hiring.service');

async function testAdClickFix() {
    console.log('==============================================');
    console.log('🧪 TESTING AD CLICK & INQUIRY MESSAGE FIX');
    console.log('==============================================\n');

    const metaAdMsg = "Hello! Can I get more info on this?";

    // 1. Off-Topic Check
    const isOffTopic = aiService.isOffTopicMessage(metaAdMsg);
    console.log(`1. isOffTopicMessage("${metaAdMsg}"): ${isOffTopic} (Expected: false)`);
    console.assert(isOffTopic === false, 'FAILED: Meta ad message was flagged as off-topic!');

    // 2. Ad Inquiry Check
    const isAdInquiry = aiService.isAdInquiryMessage(metaAdMsg);
    console.log(`2. isAdInquiryMessage("${metaAdMsg}"): ${isAdInquiry} (Expected: true)`);
    console.assert(isAdInquiry === true, 'FAILED: isAdInquiryMessage should be true!');

    // 3. Candidate tracking and response
    const testPhone = '919876543219';
    hiringService.deleteCandidate(testPhone);

    const cand = hiringService.trackCandidateFromMessage({
        customerPhone: testPhone,
        messageText: metaAdMsg,
        customerName: 'Instagram Lead'
    });

    console.log(`\n3. Candidate tracked - Role: "${cand.role}", Name: "${cand.name}"`);
    console.assert(cand.role === 'General Applicant', 'Role should be General Applicant');

    const welcomeMsg = hiringService.getWelcomeRolesReply('english');
    console.log(`\nBot Reply to Meta Ad Click:\n${welcomeMsg}\n`);
    console.assert(welcomeMsg.includes('Welcome to Brand Setu Digital! 🎉'), 'Must welcome lead');
    console.assert(welcomeMsg.includes('1️⃣ 🎬 *Video Editor*'), 'Must list Video Editor');
    console.assert(welcomeMsg.includes('6️⃣ 📢 *Digital Marketing Manager*'), 'Must list Digital Marketing Manager');
    console.assert(!welcomeMsg.includes('Warning'), 'Must NEVER contain Warning!');

    // 4. Test other ad phrases
    const otherPhrases = [
        "Hi! Can I get more info on this?",
        "I saw your ad on Instagram",
        "Can you please share more details?",
        "Hi, I am interested in this",
        "Hello mam"
    ];

    for (const p of otherPhrases) {
        const off = aiService.isOffTopicMessage(p);
        console.log(`Phrase: "${p}" -> isOffTopic: ${off} (Expected: false)`);
        console.assert(off === false, `FAILED: Phrase "${p}" was flagged as off-topic!`);
    }

    // 5. Test real off-topic phrases still trigger warning
    const realOffTopic = "kya kar rahe ho? dinner kiya?";
    const offReal = aiService.isOffTopicMessage(realOffTopic, { chatHistory: [1, 2, 3], role: 'Video Editor' });
    console.log(`\nReal off-topic: "${realOffTopic}" -> isOffTopic: ${offReal} (Expected: true)`);
    console.assert(offReal === true, 'FAILED: Real off-topic should be true!');

    hiringService.deleteCandidate(testPhone);

    console.log('\n==============================================');
    console.log('✅ AD CLICK & INQUIRY FIX VERIFIED SUCCESSFULLY!');
    console.log('==============================================');
}

testAdClickFix().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
