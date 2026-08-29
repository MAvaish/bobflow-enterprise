/**
 * Automated Edge-Case Unit Test Suite
 * Account Transaction Processing Engine — account_service.js
 *
 * Covers all 15 test cases specified in sdlc-modernization-plan.md Sub-Task 4.
 * Zero external dependencies — runs with: node src/__tests__/account_service.test.js
 * Compatible with Jest and Mocha (test function names map directly to describe/it blocks).
 *
 * Spec coverage:
 *   legacy_specs.txt §1 → T-01, T-02, T-03, T-06, T-07, T-15
 *   legacy_specs.txt §2 → T-11, T-12, T-13, T-14
 *   legacy_specs.txt §3 → T-08, T-09, T-10
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { processTransaction, processedTokens } = require(path.join(__dirname, '..', 'account_service'));

// ---------------------------------------------------------------------------
// Minimal test harness (no external deps required)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  // Reset token store before every test so tests are fully isolated
  processedTokens.clear();
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

function assertThrows(fn, expectedMessage) {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    if (expectedMessage) {
      assert.strictEqual(
        err.message,
        expectedMessage,
        `Expected error message "${expectedMessage}" but got "${err.message}"`
      );
    }
  }
  if (!threw) {
    throw new Error(`Expected function to throw but it did not`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fresh unique token each call */
let _tokenCounter = 0;
function uniqueToken() {
  return `test-token-${++_tokenCounter}`;
}

/** Returns a fresh ACTIVE account with the given balance */
function makeAccount(balance = 10000) {
  return { id: 'ACC-TEST', status: 'ACTIVE', balance };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

console.log('\nAccount Service — Edge-Case Unit Tests');
console.log('══════════════════════════════════════\n');

// ── Happy Path ──────────────────────────────────────────────────────────────

test('T-01: Valid active account, positive amount under $10k, valid token → COMPLETED', () => {
  const account = makeAccount(5000);
  const result = processTransaction(account, 250, uniqueToken(), false);
  assert.strictEqual(result.status, 'COMPLETED');
  assert.strictEqual(result.remainingBalance, 4750);
});

// ── Account Validation ───────────────────────────────────────────────────────

test('T-02: Null account → throws "Account inactive or invalid"', () => {
  assertThrows(
    () => processTransaction(null, 100, uniqueToken(), false),
    'Account inactive or invalid'
  );
});

test('T-03: Account with status !== ACTIVE → throws "Account inactive or invalid"', () => {
  const account = { id: 'ACC-002', status: 'SUSPENDED', balance: 5000 };
  assertThrows(
    () => processTransaction(account, 100, uniqueToken(), false),
    'Account inactive or invalid'
  );
});

// ── Amount Validation ────────────────────────────────────────────────────────

test('T-04: Amount = 0 → throws "Invalid transaction amount"', () => {
  assertThrows(
    () => processTransaction(makeAccount(), 0, uniqueToken(), false),
    'Invalid transaction amount'
  );
});

test('T-05: Negative amount → throws "Invalid transaction amount"', () => {
  assertThrows(
    () => processTransaction(makeAccount(), -500, uniqueToken(), false),
    'Invalid transaction amount'
  );
});

// ── Balance Guard (Spec §1 — non-negative balance index) ────────────────────

test('T-06: Amount exceeds balance → throws "Insufficient funds"', () => {
  const account = makeAccount(100);
  assertThrows(
    () => processTransaction(account, 500, uniqueToken(), false),
    'Insufficient funds: transaction would result in a negative balance'
  );
});

test('T-07: Amount exactly equals balance → COMPLETED, remainingBalance = 0', () => {
  const account = makeAccount(500);
  const result = processTransaction(account, 500, uniqueToken(), false);
  assert.strictEqual(result.status, 'COMPLETED');
  assert.strictEqual(result.remainingBalance, 0);
  assert.strictEqual(account.balance, 0);
});

// ── Idempotency (Spec §3) ────────────────────────────────────────────────────

test('T-08: No token provided → throws "Missing idempotency token"', () => {
  assertThrows(
    () => processTransaction(makeAccount(), 100, undefined, false),
    'Missing idempotency token'
  );
});

test('T-09: Duplicate token reused → throws "Duplicate idempotency token"', () => {
  const account = makeAccount(5000);
  const token = uniqueToken();
  // First call succeeds
  processTransaction(account, 100, token, false);
  // Second call with same token must throw
  assertThrows(
    () => processTransaction(account, 100, token, false),
    'Duplicate idempotency token: transaction already processed'
  );
});

test('T-10: Two different tokens for same account → both succeed independently', () => {
  const account = makeAccount(5000);
  const result1 = processTransaction(account, 100, uniqueToken(), false);
  const result2 = processTransaction(account, 100, uniqueToken(), false);
  assert.strictEqual(result1.status, 'COMPLETED');
  assert.strictEqual(result2.status, 'COMPLETED');
  assert.strictEqual(account.balance, 4800);
});

// ── Tier-2 Approval (Spec §2 — $10k threshold) ──────────────────────────────

test('T-11: Amount > $10k, tier2ApprovalVerified = false → PENDING_APPROVAL', () => {
  const result = processTransaction(makeAccount(50000), 15000, uniqueToken(), false);
  assert.strictEqual(result.status, 'PENDING_APPROVAL');
  assert.strictEqual(result.amount, 15000);
});

test('T-12: Amount > $10k, tier2ApprovalVerified = true → COMPLETED', () => {
  const account = makeAccount(50000);
  const result = processTransaction(account, 15000, uniqueToken(), true);
  assert.strictEqual(result.status, 'COMPLETED');
  assert.strictEqual(result.remainingBalance, 35000);
});

test('T-13: Amount exactly $10,000 → COMPLETED (boundary: $10k is NOT > $10k)', () => {
  const account = makeAccount(50000);
  const result = processTransaction(account, 10000, uniqueToken(), false);
  assert.strictEqual(result.status, 'COMPLETED');
  assert.strictEqual(result.remainingBalance, 40000);
});

test('T-14: Amount = $10,001 without approval → PENDING_APPROVAL', () => {
  const result = processTransaction(makeAccount(50000), 10001, uniqueToken(), false);
  assert.strictEqual(result.status, 'PENDING_APPROVAL');
  assert.strictEqual(result.amount, 10001);
});

// ── Mutation Correctness (Spec §1 — balance integrity) ──────────────────────

test('T-15: Successful transaction mutates account.balance correctly', () => {
  const account = makeAccount(1000);
  const startingBalance = account.balance;
  const deduction = 350;
  processTransaction(account, deduction, uniqueToken(), false);
  assert.strictEqual(account.balance, startingBalance - deduction);
  assert.strictEqual(account.balance, 650);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n──────────────────────────────────────');
console.log(`  Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(({ name, message }) => {
    console.error(`  ✗ ${name}`);
    console.error(`      ${message}`);
  });
  console.log('');
  process.exit(1);
} else {
  console.log('  All tests passed. ✓');
  console.log('');
  process.exit(0);
}
