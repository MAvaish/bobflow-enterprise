'use strict';
// Smoke-test the watsonx-evaluate handler logic without starting a full server.
// Inline the exact same logic used by handleWatsonxEvaluate.
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT     = path.resolve(__dirname, '..', '..');
const srcPath  = path.join(ROOT, 'src', 'account_service.js');
const specPath = path.join(ROOT, 'legacy_specs.txt');
const srcCode  = fs.existsSync(srcPath)  ? fs.readFileSync(srcPath,  'utf8') : '';
const specText = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';

const corpus  = srcCode + '\n---SPEC---\n' + specText;
const govHash = crypto.createHash('sha256').update(corpus, 'utf8').digest('hex');

const specChecks = [
  { id:'SPEC-1a', compliant: /account\.status\s*!==\s*['"]ACTIVE['"]/.test(srcCode) },
  { id:'SPEC-1b', compliant: /account\.balance\s*<\s*amount/.test(srcCode) },
  { id:'SPEC-2',  compliant: /tier2ApprovalVerified/.test(srcCode) && /amount\s*>\s*10000/.test(srcCode) },
  { id:'SPEC-3a', compliant: /idempotencyToken/.test(srcCode) && /Missing idempotency token/.test(srcCode) },
  { id:'SPEC-3b', compliant: /processedTokens\.has\(idempotencyToken\)/.test(srcCode) },
  { id:'SPEC-4',  compliant: /@deprecated|v1.*batch/i.test(srcCode) },
];
const nistChecks = [
  { control:'NIST AC-3',  status: /tier2ApprovalVerified/.test(srcCode) ? 'PASS' : 'FAIL' },
  { control:'NIST SI-10', status: /amount\s*<=\s*0/.test(srcCode) && /!account/.test(srcCode) ? 'PASS' : 'FAIL' },
  { control:'NIST SC-5',  status: /processedTokens\.has\(idempotencyToken\)/.test(srcCode) ? 'PASS' : 'FAIL' },
  { control:'NIST AU-9',  status: /'use strict'/.test(srcCode) && !/\beval\s*\(/.test(srcCode) ? 'PASS' : 'FAIL' },
];

const specPassed = specChecks.filter(c => c.compliant).length;
const nistPassed = nistChecks.filter(c => c.status === 'PASS').length;
const total      = specChecks.length + nistChecks.length;
const pct        = Math.round(((specPassed + nistPassed) / total) * 100);
const grade      = pct === 100 ? 'A+' : pct >= 90 ? 'A' : 'B';

console.log('\n══ watsonx Evaluate Smoke Test ══');
console.log('  Spec checks  : ' + specPassed + '/' + specChecks.length);
specChecks.forEach(c => console.log('    [' + (c.compliant ? 'PASS' : 'FAIL') + '] ' + c.id));
console.log('  NIST checks  : ' + nistPassed + '/' + nistChecks.length);
nistChecks.forEach(c => console.log('    [' + c.status + '] ' + c.control));
console.log('  Compliance   : ' + pct + '%');
console.log('  Grade        : ' + grade);
console.log('  SHA-256 hash : ' + govHash.slice(0, 16) + '…');
console.log('  Full hash len: ' + govHash.length + ' chars (expect 64)');
console.log('');
if (pct === 100 && grade === 'A+' && govHash.length === 64) {
  console.log('  RESULT: ALL ASSERTIONS PASSED ✓');
  process.exit(0);
} else {
  console.error('  RESULT: SMOKE TEST FAILED');
  process.exit(1);
}
