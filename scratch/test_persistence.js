const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Test hiring service persistence & merge
const hiringService = require('../services/hiring.service');

async function testPersistence() {
  console.log('--- Test 1: Load Candidates & Mirror Backup ---');
  hiringService.loadCandidates();
  const cands = hiringService.getCandidates();
  console.log(`✅ Loaded ${cands.length} candidates.`);
  assert(cands.length > 0, 'Should load existing candidates');

  assert(fs.existsSync(hiringService.CANDIDATES_BACKUP_FILE), 'Mirror backup file should exist');
  console.log('✅ Mirror backup candidates_data.backup.json exists.');

  console.log('\n--- Test 2: Deletion Persistence ---');
  const testPhone = '918888888888';
  // Simulate adding a candidate
  hiringService.trackCandidateFromMessage({
    customerPhone: testPhone,
    customerName: 'Test Candidate Persistence',
    messageText: 'Hello I am applying for Video Editor',
    messageType: 'text'
  });

  let found = hiringService.getCandidates().find(c => c.phone === testPhone);
  assert(found, 'Test candidate should exist');
  console.log('✅ Test candidate created.');

  // Delete candidate
  hiringService.deleteCandidate(found.id);
  const deletedPhones = hiringService.getDeletedPhones();
  assert(deletedPhones.includes(testPhone), 'Deleted phone should be in deleted list');
  console.log('✅ Phone recorded in deleted_candidates.json');

  // Reload candidates to ensure deleted candidate does not return
  hiringService.loadCandidates();
  const foundAfterReload = hiringService.getCandidates().find(c => c.phone === testPhone);
  assert(!foundAfterReload, 'Deleted candidate should NOT return after reload');
  console.log('✅ Reload verified: deleted candidate did NOT return.');

  // Clean up deleted list for test phone
  hiringService.removeDeletedPhone(testPhone);

  console.log('\n--- Test 3: Backup & Restore / Merge ---');
  const sampleBackup = [
    {
      id: 'cand_test_merge_01',
      phone: '917777777777',
      name: 'Merge Test Candidate',
      role: 'Graphic Designer',
      city: 'Indore',
      lang: 'english',
      experience: 'Experienced (Full-Time)',
      status: 'Applied',
      chatHistory: [
        { role: 'user', text: 'Hi applying for Graphic Designer', timestamp: new Date().toISOString() }
      ]
    }
  ];

  const totalRestored = hiringService.restoreFromBackup(sampleBackup);
  console.log(`✅ Restored / Merged count: ${totalRestored}`);
  const mergeFound = hiringService.getCandidates().find(c => c.phone === '917777777777');
  assert(mergeFound, 'Restored candidate should exist in pipeline');
  console.log('✅ Restored candidate successfully verified.');

  // Clean up merge test candidate
  hiringService.deleteCandidate(mergeFound.id);
  hiringService.removeDeletedPhone('917777777777');

  console.log('\n🎉 ALL PERSISTENCE AND RE-DEPLOY SAFETY TESTS PASSED!');
}

testPersistence().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
