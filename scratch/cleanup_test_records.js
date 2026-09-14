const hiringService = require('../services/hiring.service');
const testPhones = ['919876543210', '919876543211'];

let candidates = hiringService.getCandidates();
const beforeCount = candidates.length;
candidates = candidates.filter(c => !testPhones.includes(c.phone));
const afterCount = candidates.length;

if (beforeCount !== afterCount) {
  const fs = require('fs');
  fs.writeFileSync(hiringService.CANDIDATES_JSON_FILE, JSON.stringify(candidates, null, 2), 'utf8');
  hiringService.loadCandidates();
  hiringService.saveCandidatesAndSyncExcel(false);
  console.log(`Cleaned up ${beforeCount - afterCount} test records.`);
} else {
  console.log('No test records to clean.');
}
process.exit(0);
