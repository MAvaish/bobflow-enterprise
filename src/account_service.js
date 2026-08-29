/**
 * Account Transaction Processing Engine
 *
 * @module account_service
 *
 * @deprecated v1 Fixed-Width Batch Reconciliation
 * Any consumer still invoking fixed-width batch reconciliation (v1) MUST migrate to
 * REST event streaming. The v1 pattern is formally obsolete per legacy_specs.txt §4.
 * See docs/onboarding-guide.md → "v1 Batch Reconciliation Migration" for the target pattern.
 */

'use strict';

/**
 * In-memory store for processed idempotency tokens.
 * Exported to allow test suites to reset state between test runs.
 * In production, replace with a distributed cache (e.g. Redis) keyed by token + account ID.
 * @type {Set<string>}
 */
const processedTokens = new Set();

/**
 * Process a financial transaction against an account.
 *
 * @param {object} account               - The account object to transact against.
 * @param {string} account.status        - Must be 'ACTIVE'.
 * @param {number} account.balance       - Current balance; must cover the transaction amount.
 * @param {number} amount                - Transaction amount; must be a positive number.
 * @param {string} idempotencyToken      - Unique caller-supplied token; re-use throws to prevent double-spend.
 * @param {boolean} tier2ApprovalVerified - Must be true (verified by Tier-2 Manager) for amounts > $10,000.
 *                                         TODO: Replace this boolean with a signed approval claim verified
 *                                         against the internal Tier-2 Approval Service before trusting.
 * @returns {{ status: string, remainingBalance?: number, amount?: number }}
 */
function processTransaction(account, amount, idempotencyToken, tier2ApprovalVerified) {
  // Spec §3 — Idempotency: token must be present
  if (!idempotencyToken) {
    throw new Error('Missing idempotency token');
  }

  // Spec §3 — Idempotency: reject duplicate submissions (prevents double-spend)
  if (processedTokens.has(idempotencyToken)) {
    throw new Error('Duplicate idempotency token: transaction already processed');
  }

  // Spec §1 — Account must exist and be ACTIVE
  if (!account || account.status !== 'ACTIVE') {
    throw new Error('Account inactive or invalid');
  }

  // Amount must be a positive number
  if (amount <= 0) {
    throw new Error('Invalid transaction amount');
  }

  // Spec §2 — Transactions > $10,000 require verified Tier-2 Manager approval
  if (amount > 10000 && !tier2ApprovalVerified) {
    return { status: 'PENDING_APPROVAL', amount };
  }

  // Spec §1 — Non-negative balance: reject if deduction would overdraw the account
  if (account.balance < amount) {
    throw new Error('Insufficient funds: transaction would result in a negative balance');
  }

  // Commit the deduction and record the token to prevent replay
  account.balance -= amount;
  processedTokens.add(idempotencyToken);

  return { status: 'COMPLETED', remainingBalance: account.balance };
}

module.exports = { processTransaction, processedTokens };
