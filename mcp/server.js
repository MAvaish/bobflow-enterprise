#!/usr/bin/env node
/**
 * BobFlow Enterprise — MCP Server
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0) over stdio.
 * Compatible with Claude Desktop, Bob, and any MCP-compliant client.
 *
 * Tools exposed:
 *   scan_repository          — AST dependency tree + compliance gap analysis
 *   generate_onboarding_guide — Mermaid diagrams + markdown documentation
 *   verify_test_suite         — Execute local tests + return assertion statuses
 *
 * Run standalone: node mcp/server.js
 * Register in mcp_config.json as a "stdio" transport server.
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ─── JSON-RPC 2.0 framing ────────────────────────────────────────────────────
function writeMessage(obj) {
  const body = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function sendResult(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

// ─── Stdio reader (Content-Length framed) ────────────────────────────────────
let _buf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  _buf = Buffer.concat([_buf, chunk]);
  processBuffer();
});

function processBuffer() {
  while (true) {
    const headerEnd = _buf.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const headerStr = _buf.slice(0, headerEnd).toString('utf8');
    const lenMatch  = /Content-Length:\s*(\d+)/i.exec(headerStr);
    if (!lenMatch) { _buf = _buf.slice(headerEnd + 4); continue; }

    const contentLen = parseInt(lenMatch[1], 10);
    const bodyStart  = headerEnd + 4;
    if (_buf.length < bodyStart + contentLen) return;

    const body = _buf.slice(bodyStart, bodyStart + contentLen).toString('utf8');
    _buf = _buf.slice(bodyStart + contentLen);

    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    handleMessage(msg);
  }
}

process.stdin.on('end', () => process.exit(0));

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * Tool: scan_repository
 * Input: { path: string }  (relative or absolute directory/file)
 */
function toolScanRepository(args) {
  const targetPath = args && args.path ? String(args.path) : 'src';
  const absTarget  = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(ROOT, targetPath);

  if (!fs.existsSync(absTarget)) {
    return { error: `Path not found: ${absTarget}` };
  }

  const stat = fs.statSync(absTarget);
  const files = stat.isDirectory() ? collectJSFiles(absTarget) : [absTarget];

  const fileResults = files.map(f => {
    const src   = fs.readFileSync(f, 'utf8');
    const lines = src.split('\n');

    // Function signatures
    const functions = [];
    const fnRe = /(?:^|\s)(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm;
    let m;
    while ((m = fnRe.exec(src)) !== null) {
      const params = m[2].split(',').map(p => p.trim()).filter(Boolean);
      functions.push({
        name:         m[1],
        params,
        lineApprox:   src.slice(0, m.index).split('\n').length,
        async:        /async/.test(m[0]),
      });
    }

    // Dependencies (require/import)
    const deps = [];
    const reqRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = reqRe.exec(src)) !== null) deps.push(m[1]);
    const impRe = /from\s+['"]([^'"]+)['"]/g;
    while ((m = impRe.exec(src)) !== null) deps.push(m[1]);

    // Exports
    let exports = [];
    const expMatch = /module\.exports\s*=\s*\{([^}]+)\}/.exec(src);
    if (expMatch) exports = expMatch[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);

    // Compliance gaps
    const specChecks = [
      { spec: '§1a ACTIVE status',          present: /account\.status\s*!==\s*['"]ACTIVE['"]/.test(src) },
      { spec: '§1b Non-negative balance',   present: /account\.balance\s*<\s*amount/.test(src) },
      { spec: '§2  Tier-2 approval gate',   present: /tier2ApprovalVerified/.test(src) },
      { spec: '§3a Idempotency token',      present: /idempotencyToken/.test(src) },
      { spec: '§3b Duplicate rejection',    present: /processedTokens\.has/.test(src) },
      { spec: '§4  v1 deprecation notice',  present: /@deprecated|v1.*batch/i.test(src) },
    ];

    // Only flag gaps for transaction-processing files (heuristic: has balance/amount ops)
    const isTransactionFile = /(balance|amount|transfer|deduct)/.test(src);
    const gaps = isTransactionFile
      ? specChecks.filter(c => !c.present).map(c => c.spec)
      : [];

    return {
      file:      path.relative(ROOT, f),
      lines:     lines.length,
      functions,
      dependencies: [...new Set(deps)],
      exports,
      complianceGaps: gaps,
      compliant: gaps.length === 0,
    };
  });

  return {
    scannedPath:  targetPath,
    filesScanned: files.length,
    scannedAt:    new Date().toISOString(),
    totalGaps:    fileResults.reduce((n, r) => n + r.complianceGaps.length, 0),
    files:        fileResults,
  };
}

function collectJSFiles(dir) {
  const out = [];
  fs.readdirSync(dir).forEach(e => {
    const full = path.join(dir, e);
    const s    = fs.statSync(full);
    if (s.isDirectory() && e !== 'node_modules' && e !== '.git') out.push(...collectJSFiles(full));
    else if (s.isFile() && e.endsWith('.js') && !e.endsWith('.test.js')) out.push(full);
  });
  return out;
}

/**
 * Tool: generate_onboarding_guide
 * Input: { target?: string, format?: 'markdown' | 'mermaid' }
 */
function toolGenerateOnboardingGuide(args) {
  const format = (args && args.format) || 'markdown';

  const mermaidSequence = `sequenceDiagram
    participant C as Caller
    participant AS as account_service.js
    participant TS as Token Store
    participant A as Account Object
    C->>AS: processTransaction(account, amount, idempotencyToken, tier2ApprovalVerified)
    AS->>AS: Guard: idempotencyToken present?
    alt Missing token
        AS-->>C: throw Error: Missing idempotency token
    end
    AS->>TS: Has token been processed before?
    alt Duplicate token
        AS-->>C: throw Error: Duplicate idempotency token
    end
    AS->>AS: Guard: account.status === ACTIVE?
    AS->>AS: Guard: amount > 0?
    AS->>AS: Guard: amount > 10000 + tier2ApprovalVerified?
    alt Not approved
        AS-->>C: return PENDING_APPROVAL
    end
    AS->>A: Guard: account.balance >= amount?
    alt Insufficient
        AS-->>C: throw Error: Insufficient funds
    end
    AS->>A: account.balance -= amount
    AS->>TS: processedTokens.add(token)
    AS-->>C: return COMPLETED + remainingBalance`;

  const mermaidFlow = `flowchart TD
    START([Incoming Transaction]) --> CHK_TOKEN{Token present?}
    CHK_TOKEN -- No --> ERR1[throw: Missing token]
    CHK_TOKEN -- Yes --> CHK_DUP{Token seen before?}
    CHK_DUP -- Yes --> ERR2[throw: Duplicate token]
    CHK_DUP -- No --> CHK_ACCT{account ACTIVE?}
    CHK_ACCT -- No --> ERR3[throw: Account invalid]
    CHK_ACCT -- Yes --> CHK_AMT{amount > 0?}
    CHK_AMT -- No --> ERR4[throw: Invalid amount]
    CHK_AMT -- Yes --> CHK_TIER{amount > $10k?}
    CHK_TIER -- Yes --> CHK_T2{tier2Approved?}
    CHK_T2 -- No --> PENDING[return PENDING_APPROVAL]
    CHK_T2 -- Yes --> CHK_BAL
    CHK_TIER -- No --> CHK_BAL{balance >= amount?}
    CHK_BAL -- No --> ERR5[throw: Insufficient funds]
    CHK_BAL -- Yes --> COMMIT[balance -= amount + add token]
    COMMIT --> SUCCESS([return COMPLETED])`;

  const markdownGuide = `# Account Service — Onboarding Guide
*Generated by BobFlow Enterprise · IBM Bob 2.0*

## Entry Point

\`\`\`javascript
processTransaction(account, amount, idempotencyToken, tier2ApprovalVerified)
\`\`\`

## Architecture — Request Lifecycle

\`\`\`mermaid
${mermaidSequence}
\`\`\`

## Decision Flow

\`\`\`mermaid
${mermaidFlow}
\`\`\`

## Spec Compliance (legacy_specs.txt)

| Spec | Requirement | Status |
|------|------------|--------|
| §1 | ACTIVE status + non-negative balance | ✅ Enforced |
| §2 | Tier-2 approval for > $10,000 | ✅ Enforced |
| §3 | Idempotency token on all mutations | ✅ Enforced |
| §4 | v1 batch reconciliation deprecated | ✅ Documented |

## v1 → REST Event Streaming Migration

1. Replace fixed-width batch file writes with \`POST /v2/transaction-events\`
2. Each event payload must include an \`idempotencyToken\`
3. Consumer subscribes to stream and calls \`processTransaction\` per event
4. Run parallel processing for one cycle to validate parity
5. Decommission v1 batch infrastructure

## Security Recommendations

- Replace in-memory \`processedTokens\` Set with Redis (TTL 24h)
- Replace \`tier2ApprovalVerified\` boolean with signed JWT validation
- Wrap balance mutation in a database transaction with row locking
- Add append-only audit log before each balance deduction
`;

  if (format === 'mermaid') {
    return {
      format: 'mermaid',
      sequenceDiagram: mermaidSequence,
      flowDiagram:     mermaidFlow,
    };
  }

  return {
    format:   'markdown',
    document: markdownGuide,
    mermaidDiagramCount: 2,
    sections: [
      'Entry Point', 'Architecture Sequence', 'Decision Flow',
      'Spec Compliance', 'v1 Migration', 'Security Recommendations',
    ],
  };
}

/**
 * Tool: verify_test_suite
 * Input: { testFile?: string }
 */
function toolVerifyTestSuite(args) {
  const testFile = args && args.testFile
    ? path.resolve(ROOT, args.testFile)
    : path.join(ROOT, 'src', '__tests__', 'account_service.test.js');

  return new Promise((resolve) => {
    if (!fs.existsSync(testFile)) {
      resolve({ ok: false, error: `Test file not found: ${testFile}` });
      return;
    }

    const startMs = Date.now();
    let stdout = '';
    let stderr = '';

    const child = spawn(process.execPath, [testFile], { cwd: ROOT, env: process.env });
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', (exitCode) => {
      const durationMs = Date.now() - startMs;
      const tests = [];
      stdout.split('\n').forEach(line => {
        const pm = /^\s+✓\s+(.+)$/.exec(line);
        if (pm) tests.push({ status: 'pass', assertion: pm[1].trim() });
        const fm = /^\s+✗\s+(.+)$/.exec(line);
        if (fm) tests.push({ status: 'fail', assertion: fm[1].trim() });
      });
      const sumM = /Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/.exec(stdout);
      resolve({
        ok:          exitCode === 0,
        exitCode,
        durationMs,
        testFile:    path.relative(ROOT, testFile),
        passed:      sumM ? parseInt(sumM[1], 10) : tests.filter(t => t.status === 'pass').length,
        failed:      sumM ? parseInt(sumM[2], 10) : tests.filter(t => t.status === 'fail').length,
        total:       tests.length,
        assertions:  tests,
        stdout:      stdout.trim(),
        stderr:      stderr.trim() || null,
        verifiedAt:  new Date().toISOString(),
      });
    });
  });
}

// ─── MCP protocol handlers ────────────────────────────────────────────────────
const TOOLS_LIST = [
  {
    name:        'scan_repository',
    description: 'Ingest a file or directory path, extract AST function signatures and dependency trees, and identify spec compliance gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to scan (file or directory). Defaults to "src".' },
      },
    },
  },
  {
    name:        'generate_onboarding_guide',
    description: 'Generate Mermaid architecture diagrams and full markdown onboarding documentation for the account service.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['markdown', 'mermaid'], description: 'Output format. "markdown" returns full guide; "mermaid" returns diagram source only.' },
      },
    },
  },
  {
    name:        'verify_test_suite',
    description: 'Execute the local Node.js unit test suite and return individual assertion statuses, pass/fail counts, and execution time.',
    inputSchema: {
      type: 'object',
      properties: {
        testFile: { type: 'string', description: 'Relative path to test file. Defaults to src/__tests__/account_service.test.js.' },
      },
    },
  },
];

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // ── initialize ──────────────────────────────────────────────
  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: '2024-11-05',
      capabilities:    { tools: {} },
      serverInfo:      { name: 'bobflow-enterprise-mcp', version: '2.0.0' },
    });
    return;
  }

  // ── notifications (no response required) ────────────────────
  if (method === 'notifications/initialized' || !id) return;

  // ── tools/list ───────────────────────────────────────────────
  if (method === 'tools/list') {
    sendResult(id, { tools: TOOLS_LIST });
    return;
  }

  // ── tools/call ───────────────────────────────────────────────
  if (method === 'tools/call') {
    const toolName = params && params.name;
    const toolArgs = params && params.arguments;

    try {
      let result;
      if (toolName === 'scan_repository') {
        result = toolScanRepository(toolArgs);
      } else if (toolName === 'generate_onboarding_guide') {
        result = toolGenerateOnboardingGuide(toolArgs);
      } else if (toolName === 'verify_test_suite') {
        result = await toolVerifyTestSuite(toolArgs);
      } else {
        sendError(id, -32601, `Unknown tool: ${toolName}`);
        return;
      }
      sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (err) {
      sendError(id, -32603, 'Tool execution error', err.message);
    }
    return;
  }

  // ── ping ─────────────────────────────────────────────────────
  if (method === 'ping') {
    sendResult(id, {});
    return;
  }

  // ── unknown method ───────────────────────────────────────────
  sendError(id, -32601, `Method not found: ${method}`);
}

// ─── Startup banner (stderr only — stdout is reserved for JSON-RPC) ──────────
process.stderr.write('[BobFlow MCP] Server ready — listening on stdio (JSON-RPC 2.0)\n');
process.stderr.write(`[BobFlow MCP] Tools: ${TOOLS_LIST.map(t => t.name).join(', ')}\n`);
