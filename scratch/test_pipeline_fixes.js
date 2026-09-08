const {
    trackCandidateFromMessage,
    cleanCandidateName,
    extractNameFromResumeFilename,
    isThirdPartyRecruitmentForward,
    isValidPortfolioUrl,
    getCandidateSalutation
} = require('../services/hiring.service');
const {
    isPartTimeQuery,
    generateHiringAIResponse
} = require('../services/ai.service');

async function runTests() {
    console.log('====================================');
    console.log('🧪 RUNNING COMPREHENSIVE PIPELINE TESTS');
    console.log('====================================\n');

    // TEST 1: Name Extraction on "I am looking for..."
    console.log('Test 1: Candidate says "Hello mam I am looking for an internship For 2 and half hrs in a day"');
    const msg1 = "Hello mam I am looking for an internship For 2 and half hrs in a day";
    const cleaned = cleanCandidateName("Looking");
    console.log(`cleanCandidateName("Looking"): "${cleaned}" (Expected: "Candidate" or "")`);
    console.assert(cleaned === 'Candidate' || cleaned === '', 'FAILED: "Looking" was not rejected!');

    const candidate = trackCandidateFromMessage({
        customerPhone: '919999999999',
        messageText: msg1,
        customerName: 'Looking'
    });
    console.log(`Tracked candidate name: "${candidate.name}", isNameVerified: ${candidate.isNameVerified}`);
    console.assert(candidate.name !== 'Looking' && !candidate.isNameVerified, 'FAILED: Candidate name is still Looking!');

    const salutation = getCandidateSalutation(candidate, 'en');
    console.log(`Salutation: "${salutation}" (Expected: "Hello!")`);
    console.assert(salutation === 'Hello!', 'FAILED: Salutation was not neutral Hello!');

    // TEST 2: Part-Time Query Detection
    console.log('\nTest 2: Detecting Part-Time query');
    const isPartTime = isPartTimeQuery(msg1);
    console.log(`isPartTimeQuery: ${isPartTime} (Expected: true)`);
    console.assert(isPartTime === true, 'FAILED: Part time query not detected!');

    // TEST 3: Name extraction from Resume filename
    console.log('\nTest 3: Extract name from resume filename');
    const fn1 = "Bhoomika_Sankhla_Resume.PNG";
    const name1 = extractNameFromResumeFilename(fn1);
    console.log(`Filename "${fn1}" -> Extracted: "${name1}"`);
    console.assert(name1 === 'Bhoomika Sankhla', 'FAILED: Name extraction failed for Bhoomika');

    const fn2 = "manisha_meena_cv_2026.pdf";
    const name2 = extractNameFromResumeFilename(fn2);
    console.log(`Filename "${fn2}" -> Extracted: "${name2}"`);
    console.assert(name2 === 'Manisha Meena', 'FAILED: Name extraction failed for Manisha');

    // Update candidate with resume filename
    candidate.name = name1;
    candidate.isNameVerified = true;
    const verifiedSalutation = getCandidateSalutation(candidate, 'en');
    console.log(`Verified Salutation: "${verifiedSalutation}" (Expected: "Dear Bhoomika Sankhla!")`);
    console.assert(verifiedSalutation === 'Dear Bhoomika Sankhla!', 'FAILED: Salutation did not use resume name!');

    // TEST 4: Third-Party Recruitment Forward
    console.log('\nTest 4: Detecting 3rd-Party Forwarded Interview Schedule');
    const fwdMsg = `" Greetings from IIFL Securities Pvt Ltd"! https://www.instagram.com/ap.iifl?igsh=cmZ3cTh1amZyN3Js As we discussed, here’s the interview schedule: Interview Time -10:00 to 5:00 PM - Location :- 504,6th floor A Block Corporate house near central mall Indore Please confirm your availability for the scheduled time. Looking forward to meeting you! Best regards HR Mantasha 7477007883`;
    const isFwd = isThirdPartyRecruitmentForward(fwdMsg);
    console.log(`isThirdPartyRecruitmentForward: ${isFwd} (Expected: true)`);
    console.assert(isFwd === true, 'FAILED: 3rd party forward not detected!');

    // TEST 5: Portfolio URL Validation (reject random Instagram / non-portfolio links)
    console.log('\nTest 5: Portfolio URL Validation');
    const instaLink = "https://www.instagram.com/ap.iifl?igsh=cmZ3cTh1amZyN3Js";
    const isValidPortfolio = isValidPortfolioUrl(instaLink);
    console.log(`isValidPortfolioUrl("${instaLink}"): ${isValidPortfolio} (Expected: false)`);
    console.assert(isValidPortfolio === false, 'FAILED: Instagram company link should not be treated as candidate portfolio!');

    const driveLink = "https://drive.google.com/file/d/12345/view";
    const isValidDrive = isValidPortfolioUrl(driveLink);
    console.log(`isValidPortfolioUrl("${driveLink}"): ${isValidDrive} (Expected: true)`);
    console.assert(isValidDrive === true, 'FAILED: Drive link should be valid portfolio!');

    // TEST 6: AI Response for Part-Time Query
    console.log('\nTest 6: AI Response Generation for 2.5 hr query');
    const aiResp = await generateHiringAIResponse('919999999999', msg1, { name: '' });
    console.log(`AI Response:\n${aiResp}\n`);
    console.assert(aiResp.toLowerCase().includes('in-office') || aiResp.toLowerCase().includes('onsite') || aiResp.toLowerCase().includes('full-time') || aiResp.toLowerCase().includes('full time'), 'FAILED: AI did not clarify full-time/in-office requirement!');

    console.log('====================================');
    console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
    console.log('====================================');
}

runTests().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
