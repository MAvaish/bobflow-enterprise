const fs  = require('fs');
const src = fs.readFileSync('src/account_service.js', 'utf8');
let pass = 0, fail = 0;
function check(id, desc, fn) {
  const ok = fn(src);
  console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + id + ': ' + desc);
  ok ? pass++ : fail++;
}
check('LINT-01', 'No eval() usage',               function(s){ return !/\beval\s*\(/.test(s); });
check('LINT-02', 'No console.log',                function(s){ return !/console\.log/.test(s); });
check('LINT-03', 'processedTokens exported',      function(s){ return /module\.exports.*processedTokens/.test(s); });
check('LINT-04', 'processTransaction exported',   function(s){ return /module\.exports.*processTransaction/.test(s); });
check('LINT-05', 'use strict declared',           function(s){ return /'use strict'|"use strict"/.test(s); });
check('LINT-06', '@param JSDoc annotation',       function(s){ return /@param\s+\{/.test(s); });
console.log('\nLint Summary: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
