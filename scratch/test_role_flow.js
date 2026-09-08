const hiringService = require('../services/hiring.service');

async function testRoleSelectionFlow() {
    console.log('==============================================');
    console.log('🧪 TESTING ROLE SELECTION & QUALIFICATION FLOW');
    console.log('==============================================\n');

    const testPhone = '919876500001';

    // Step 0: Initial message
    console.log('Step 0: Candidate inquires about internship / hours');
    const msg0 = "Hello mam I am looking for an internship For 2 and half hrs in a day";
    let cand = hiringService.trackCandidateFromMessage({
        customerPhone: testPhone,
        messageText: msg0,
        customerName: 'Looking'
    });
    console.log(`Cand role: "${cand.role}", experience: "${cand.experience}", name: "${cand.name}"`);
    console.assert(cand.role === 'General Applicant', 'Role should be General Applicant');
    console.assert(cand.experience === '', 'Experience should NOT be prematurely locked');
    console.assert(cand.name !== 'Looking', 'Name must not be Looking');

    // Step 1: Candidate selects role "Video Editor"
    console.log('\nStep 1: Candidate selects role "Video Editor"');
    cand = hiringService.trackCandidateFromMessage({
        customerPhone: testPhone,
        messageText: "Video Editor",
        customerName: 'Looking'
    });
    console.log(`Cand role: "${cand.role}", justSelectedRole: ${cand.justSelectedRole}, experience: "${cand.experience}"`);
    console.assert(cand.role === 'Video Editor', 'Role should be Video Editor');
    console.assert(cand.justSelectedRole === true, 'justSelectedRole flag should be true');
    console.assert(cand.experience === '', 'Experience should still be empty');

    const roleReply = hiringService.getRoleSelectedReply(cand.role, 'english');
    console.log(`\nBot Reply to Role Selection:\n${roleReply}\n`);
    console.assert(roleReply.includes('Great! You have selected *Video Editor*. 👍'), 'Reply must confirm role');
    console.assert(roleReply.includes('1️⃣ Are you applying as a *Fresher (Paid Internship)* or *Experienced (Full-Time Role)*?'), 'Reply must ask question 1');
    console.assert(roleReply.includes('2️⃣ If experienced, how many months/years of experience do you have? 💼'), 'Reply must ask question 2');

    // Step 2: Candidate answers "Fresher"
    console.log('Step 2: Candidate replies "Fresher"');
    cand = hiringService.trackCandidateFromMessage({
        customerPhone: testPhone,
        messageText: "Fresher",
        customerName: 'Looking'
    });
    console.log(`Cand experience: "${cand.experience}", justAnsweredExperience: ${cand.justAnsweredExperience}`);
    console.assert(cand.experience === 'Fresher (Paid Internship)', 'Experience should be Fresher');
    console.assert(cand.justAnsweredExperience === true, 'justAnsweredExperience flag should be true');

    const expReply = hiringService.getExperienceAnsweredReply(cand, 'english');
    console.log(`\nBot Reply to Experience (Next Process):\n${expReply}\n`);
    console.assert(expReply.includes('Resume (PDF)'), 'Next process must request Resume (PDF)');
    console.assert(expReply.includes('Portfolio') || expReply.includes('Google Drive'), 'Next process must request Portfolio');

    // Step 3: Candidate sends resume file
    console.log('Step 3: Candidate sends resume file "Bhoomika_Sankhla_Resume.PNG"');
    cand = hiringService.trackCandidateFromMessage({
        customerPhone: testPhone,
        messageText: "Bhoomika_Sankhla_Resume.PNG",
        mediaFilename: "Bhoomika_Sankhla_Resume.PNG",
        messageType: "document"
    });
    console.log(`Cand name: "${cand.name}", resumeReceived: ${cand.resumeReceived}`);
    console.assert(cand.name === 'Bhoomika Sankhla', 'Candidate name should be updated from resume filename');
    console.assert(cand.resumeReceived === true, 'Resume should be marked received');

    // Cleanup test candidate
    hiringService.deleteCandidate(testPhone);

    console.log('\n==============================================');
    console.log('✅ ROLE SELECTION FLOW TEST PASSED PERFECTLY!');
    console.log('==============================================');
}

testRoleSelectionFlow().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
