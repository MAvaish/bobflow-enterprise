#!/usr/bin/env node
/**
 * BobFlow Enterprise CLI
 * Usage:
 *   bobflow scan <dir>     — AST/compliance scan of target directory
 *   bobflow test           — Execute unit test suite with live output
 *   bobflow serve [port]   — Launch local dashboard server (default: 3000)
 *   bobflow governance     — Print watsonx compliance payload
 *   bobflow help           — Show this help
 */

'use strict';

const path        = require('path');
const fs          = require('fs');
const { spawn }   = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ─── ANSI colour helpers ────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  white:  '\x1b[97m',
};
const ok   = (s) => `${C.green}✓${C.reset} ${s}`;
const fail = (s) => `${C.red}✗${C.reset} ${s}`;
const info = (s) => `${C.blue}›${C.reset} ${s}`;
const warn = (s) => `${C.yellow}⚠${C.reset} ${s}`;
const head = (s) => `\n${C.bold}${C.white}${s}${C.reset}\n${'─'.repeat(s.length)}`;

// ─── AST / pattern scanner ──────────────────────────────────────────────────
/**
 * Lightweight pattern-based scanner. Parses JS source line-by-line and
 * identifies function signatures, exports, guards, and compliance gaps without
 * requiring an external AST library.
 */
function scanFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const result = {
    file: path.relative(ROOT, filePath),
    lines: lines.length,
    functions: [],
    exports: [],
    guards: [],
    gaps: [],
  };

  // Collect function declarations / expressions
  const fnRe = /(?:^|\s)function\s+(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    const params = m[2].split(',').map(p => p.trim()).filter(Boolean);
    result.functions.push({ name: m[1], params });
  }

  // Collect module.exports symbols
  const expRe = /module\.exports\s*=\s*\{([^}]+)\}/;
  const expMatch = expRe.exec(src);
  if (expMatch) {
    result.exports = expMatch[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
  }

  // Detect security/compliance guards
  const guardPatterns = [
    { label: 'ACTIVE status check',          re: /account\.status\s*!==\s*['"]ACTIVE['"]/ },
    { label: 'Non-negative balance guard',    re: /account\.balance\s*<\s*amount/ },
    { label: 'Idempotency token — present',   re: /!\s*idempotencyToken/ },
    { label: 'Idempotency token — duplicate', re: /processedTokens\.has\(/ },
    { label: 'Tier-2 approval gate',          re: /amount\s*>\s*10000/ },
    { label: 'v1 deprecation notice',         re: /@deprecated|v1.*batch/i },
    { label: 'JSDoc type annotations',        re: /@param\s+\{/ },
  ];
  guardPatterns.forEach(({ label, re }) => {
    if (re.test(src)) result.guards.push(label);
  });

  // Identify spec compliance gaps
  const specChecks = [
    {
      spec: '§1 — Non-negative balance',
      present: /account\.balance\s*<\s*amount/.test(src),
    },
    {
      spec: '§2 — Tier-2 approval gate',
      present: /tier2ApprovalVerified/.test(src) && /amount\s*>\s*10000/.test(src),
    },
    {
      spec: '§3 — Idempotency token enforcement',
      present: /idempotencyToken/.test(src) && /processedTokens\.has/.test(src),
    },
    {
      spec: '§4 — v1 batch deprecation notice',
      present: /@deprecated|v1.*batch/i.test(src),
    },
  ];
  specChecks.forEach(({ spec, present }) => {
    if (!present) result.gaps.push(spec);
  });

  return result;
}

function scanDirectory(dir) {
  const absDir = path.isAbsolute(dir) ? dir : path.resolve(ROOT, dir);
  if (!fs.existsSync(absDir)) {
    console.error(fail(`Directory not found: ${absDir}`));
    process.exit(1);
  }

  const jsFiles = [];
  function walk(d) {
    fs.readdirSync(d).forEach(entry => {
      const full = path.join(d, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory() && entry !== 'node_modules' && entry !== '.git') {
        walk(full);
      } else if (stat.isFile() && entry.endsWith('.js') && !entry.endsWith('.test.js')) {
        jsFiles.push(full);
      }
    });
  }
  walk(absDir);

  console.log(head(`BobFlow Scan — ${path.relative(ROOT, absDir) || dir}`));
  console.log(info(`Scanning ${jsFiles.length} JS source file(s)...\n`));

  let totalGaps = 0;
  jsFiles.forEach(f => {
    const r = scanFile(f);
    const gapIcon = r.gaps.length === 0 ? C.green + '●' + C.reset : C.red + '●' + C.reset;
    console.log(`${gapIcon} ${C.bold}${r.file}${C.reset} ${C.dim}(${r.lines} lines)${C.reset}`);

    if (r.functions.length) {
      r.functions.forEach(fn => {
        console.log(`   ${C.cyan}fn${C.reset} ${fn.name}(${fn.params.join(', ')})`);
      });
    }
    if (r.exports.length) {
      console.log(`   ${C.dim}exports:${C.reset} ${r.exports.join(', ')}`);
    }
    if (r.guards.length) {
      console.log(`   ${C.green}guards:${C.reset}`);
      r.guards.forEach(g => console.log(`     ${ok(g)}`));
    }
    if (r.gaps.length) {
      console.log(`   ${C.red}gaps:${C.reset}`);
      r.gaps.forEach(g => console.log(`     ${fail(g)}`));
      totalGaps += r.gaps.length;
    }
    console.log();
  });

  // Summary
  console.log('─'.repeat(50));
  if (totalGaps === 0) {
    console.log(ok(`All compliance checks passed — 0 gaps found.`));
  } else {
    console.log(fail(`${totalGaps} compliance gap(s) detected.`));
  }
  console.log();

  process.exit(totalGaps > 0 ? 1 : 0);
}

// ─── TEST command ────────────────────────────────────────────────────────────
function runTests() {
  console.log(head('BobFlow Test Runner'));
  console.log(info('Spawning: node src/__tests__/account_service.test.js\n'));

  const testPath = path.join(ROOT, 'src', '__tests__', 'account_service.test.js');
  const start    = Date.now();
  const child    = spawn(process.execPath, [testPath], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  });

  child.on('close', (code) => {
    const ms = Date.now() - start;
    console.log('\n' + '─'.repeat(50));
    if (code === 0) {
      console.log(ok(`Test suite completed in ${ms}ms — exit 0`));
    } else {
      console.log(fail(`Test suite failed in ${ms}ms — exit ${code}`));
    }
    console.log();
    process.exit(code);
  });
}

// ─── SERVE command ───────────────────────────────────────────────────────────
function serveCommand(port) {
  const p = parseInt(port, 10) || 3000;
  console.log(head('BobFlow Dashboard Server'));
  // Delegate to server.js — pass port via env
  const serverPath = path.join(ROOT, 'server.js');
  if (!fs.existsSync(serverPath)) {
    console.error(fail('server.js not found. Run from the project root.'));
    process.exit(1);
  }
  const child = spawn(process.execPath, [serverPath], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(p) },
  });
  child.on('close', (code) => process.exit(code ?? 0));
}

// ─── GOVERNANCE command ──────────────────────────────────────────────────────
function governanceCommand() {
  const { buildPayload } = require(path.join(ROOT, 'src', 'watsonx_governance.js'));
  const payload = buildPayload();
  console.log(head('BobFlow Governance Payload (watsonx/Granite)'));
  console.log(JSON.stringify(payload, null, 2));
  console.log();
}

// ─── HELP ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${C.bold}${C.white}BobFlow Enterprise CLI${C.reset} v2.0.0
${C.dim}IBM Bob 2.0 · Autonomous SDLC Governance Platform${C.reset}

${C.bold}Usage:${C.reset}
  bobflow <command> [options]

${C.bold}Commands:${C.reset}
  ${C.cyan}scan <dir>${C.reset}      AST scan + spec compliance analysis of target directory
  ${C.cyan}test${C.reset}            Execute unit test suite (src/__tests__/account_service.test.js)
  ${C.cyan}serve [port]${C.reset}    Launch local dashboard server (default port: 3000)
  ${C.cyan}governance${C.reset}      Print watsonx/Granite compliance payload as JSON
  ${C.cyan}help${C.reset}            Show this help message

${C.bold}Examples:${C.reset}
  node bin/bobflow.js scan src
  node bin/bobflow.js test
  node bin/bobflow.js serve 3000
  node bin/bobflow.js governance
`);
}

// ─── DISPATCH ────────────────────────────────────────────────────────────────
const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'scan':
    scanDirectory(args[0] || 'src');
    break;
  case 'test':
    runTests();
    break;
  case 'serve':
    serveCommand(args[0]);
    break;
  case 'governance':
    governanceCommand();
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    printHelp();
    break;
  default:
    console.error(fail(`Unknown command: "${cmd}"`));
    printHelp();
    process.exit(1);
}
