# Security & Modernization Risk Audit Report
## Account Transaction Processing Engine

**Classification:** Internal Engineering — Confidential
**Scope:** `src/account_service.js` vs. `legacy_specs.txt` compliance baseline
**Audit Basis:** Static code analysis + specification cross-reference
**Modernization Version:** v2.0 (post-SDLC modernization)

---

## Executive Summary

A cross-reference of `src/account_service.js` against the four business requirements in
`legacy_specs.txt` revealed **six distinct risk findings**: two HIGH severity, two MEDIUM,
and two LOW. The two HIGH findings — missing idempotency enforcement and the ability to
drive account balances negative — represent direct financial risk (double-spend and overdraft).
Both were remediated in the v2.0 modernization.

The two MEDIUM findings (unverified Tier-2 approval claim and unprotected in-place balance
mutation) are partially mitigated by v2.0 changes but require additional architectural work
to fully close. The two LOW findings are documentation and API hygiene issues with no
immediate financial impact.

**Net risk posture after v2.0 modernization: reduced from HIGH to MEDIUM-LOW.**

---

## Findings Table

| ID | Severity | Category | Finding | Location | Status (post-v2.0) |
|----|----------|----------|---------|----------|--------------------|
| R-01 | 🔴 HIGH | Idempotency | No idempotency enforcement — duplicate submissions cause double-spend | `account_service.js:12` (pre-fix) | ✅ Remediated |
| R-02 | 🔴 HIGH | Balance Integrity | No pre-deduction guard — balance can be driven negative | `account_service.js:12` (pre-fix) | ✅ Remediated |
| R-03 | 🟡 MEDIUM | Access Control | Tier-2 approval is a caller-asserted boolean — no verification | `account_service.js:9` | ⚠️ Partially mitigated |
| R-04 | 🟡 MEDIUM | Data Integrity | In-place object mutation — no rollback or audit trail | `account_service.js:12` | ⚠️ Architectural gap remains |
| R-05 | 🟢 LOW | Compliance | v1 fixed-width batch reconciliation not migrated to REST event streaming | `legacy_specs.txt:4` | ⚠️ Migration required |
| R-06 | 🟢 LOW | API Design | Single exported symbol, no API versioning or deprecation signaling | `account_service.js:16` (pre-fix) | ✅ Partially addressed |

---

## Detailed Finding Write-Ups

---

### R-01 — Missing Idempotency Enforcement (HIGH)

**Description:**
The original `processTransaction` function accepted no idempotency token parameter. Every call
was treated as a new transaction regardless of whether the caller had already submitted it.

**Risk:**
On any network timeout or client retry, the same financial transaction would be executed twice,
debiting the account balance twice for a single intended payment. This is a classic **double-spend
vulnerability** and a direct financial loss vector.

**Evidence (pre-fix):**
```javascript
// src/account_service.js (v1) — no token parameter, no deduplication
function processTransaction(account, amount, requiresApproval) {
  // ... no idempotency check ...
  account.balance -= amount;  // line 12: executes unconditionally on every call
  return { status: 'COMPLETED', remainingBalance: account.balance };
}
```

**Remediation Applied (v2.0):**
- Added `idempotencyToken` as a required parameter (throws if absent)
- Added a module-scoped `processedTokens` Set that records every committed token
- Added a duplicate-token guard that throws before any balance mutation occurs
- Token is only added to the Set **after** the balance is committed — preventing phantom token
  registration on failed transactions

**Residual Risk:**
The token store is in-process memory (`Set`). On process restart, all tokens are cleared,
re-opening a replay window for the TTL of the deployment window.
**Required:** Replace with a distributed cache (Redis, Memcached) with a 24-hour TTL.

---

### R-02 — No Pre-Deduction Balance Guard (HIGH)

**Description:**
The original code performed `account.balance -= amount` without first checking that
`account.balance >= amount`. This allowed the balance to become a negative number.

**Risk:**
Negative balances violate Spec §1 ("non-negative balance index") and represent an overdraft
condition. In financial systems, permitting overdrafts without explicit credit facility
agreements creates regulatory liability and potential fraud vectors (intentional overdraft abuse).

**Evidence (pre-fix):**
```javascript
// account.balance could be 100, amount could be 500 — result: balance = -400
account.balance -= amount;  // line 12: no guard
```

**Remediation Applied (v2.0):**
```javascript
if (account.balance < amount) {
  throw new Error('Insufficient funds: transaction would result in a negative balance');
}
account.balance -= amount;
```

**Residual Risk:** None at the application layer. Infrastructure-layer race conditions
(concurrent transactions against the same account) are not addressed here — require
database-level row locking or optimistic concurrency control.

---

### R-03 — Unverified Tier-2 Approval Claim (MEDIUM)

**Description:**
The `requiresApproval` (now `tier2ApprovalVerified`) parameter is a plain boolean supplied
by the calling code. The service has no way to distinguish a legitimately approved transaction
from a caller that simply passes `true` to bypass the approval gate.

**Risk:**
A misconfigured or malicious caller can authorize high-value transactions (> $10,000) without
obtaining real Tier-2 Manager approval, circumventing the regulatory control defined in Spec §2.

**Evidence:**
```javascript
// Caller can trivially bypass approval:
processTransaction(account, 50000, token, true); // true — no actual approval obtained
```

**Remediation Applied (v2.0):**
- Parameter renamed from `requiresApproval` to `tier2ApprovalVerified` to make intent explicit
- Inline TODO added in code directing developers to replace the boolean with a signed approval claim
- Documented in onboarding guide as a known gap

**Required Full Remediation:**
Replace `tier2ApprovalVerified: boolean` with a **signed short-lived JWT** issued by an
authoritative Tier-2 Approval Service. `processTransaction` should validate the JWT signature,
expiry, and embedded `accountId`/`amount` claims before proceeding.

---

### R-04 — In-Place Object Mutation Without Audit Trail (MEDIUM)

**Description:**
`account.balance` is mutated directly on the caller's object reference. There is no:
- Immutable transaction log or audit record
- Rollback mechanism if a downstream operation fails after `processTransaction` returns
- Event emission to notify other system components of the state change

**Risk:**
If a caller's orchestration logic fails after receiving `COMPLETED` but before persisting the
result (e.g. a crash between the service call and the database write), the in-memory balance
reflects the deduction but the persistent store does not. This creates a split-brain state.

**Remediation Recommendations:**
1. **Short-term:** Document the rollback responsibility in the onboarding guide (done).
2. **Medium-term:** Introduce a transaction log — append an immutable record to an audit array
   before mutating the balance: `account.transactions.push({ token, amount, timestamp })`.
3. **Long-term:** Move to an **event-sourced ledger** model where balance is derived from
   an append-only event stream, not a mutable field.

**Status:** Architectural gap — not fully addressed in v2.0 scope. Added to P1 roadmap.

---

### R-05 — v1 Batch Reconciliation Not Migrated (LOW)

**Description:**
`legacy_specs.txt §4` formally deprecates the v1 fixed-width batch reconciliation pattern
and mandates migration to REST event streaming. No code in the repository implements the
replacement streaming pattern, and no migration path was documented before this audit.

**Risk:**
Continued use of v1 batch processing creates idempotency gaps (batch records do not carry
tokens), delays failure detection (batch jobs are periodic, not real-time), and is architecturally
incompatible with the idempotency system introduced in v2.0.

**Remediation Applied (v2.0):**
- Module-level JSDoc deprecation notice added to `account_service.js`
- Full migration guide (side-by-side v1 vs. v2 patterns) added to `docs/onboarding-guide.md §7`

**Required Full Remediation:** See migration checklist in `docs/onboarding-guide.md §7`.

---

### R-06 — No API Versioning or Deprecation Signaling (LOW)

**Description:**
The original `module.exports = { processTransaction }` exports a single symbol with no
version namespace, no deprecated-function annotation, and no mechanism for callers to detect
breaking changes in the function signature.

**Risk:**
When the function signature changes (as it did in v2.0 — adding `idempotencyToken` and
renaming the approval parameter), all callers break silently at runtime rather than receiving
a compile-time or load-time warning.

**Remediation Applied (v2.0):**
- `module.exports` now exports both `processTransaction` and `processedTokens`
- JSDoc annotations on the function document all parameters and return shapes
- Module-level deprecation comment added for v1 batch consumers

**Required Full Remediation:** Introduce semantic versioning in `package.json` and consider
publishing the service as an internal npm package so consumers pin a version.

---

## Modernization Risk Assessment

### Current Architecture Risks

```
┌─────────────────────────────────────────────────────────────────┐
│  RISK AREA              │  CURRENT STATE          │  TARGET     │
├─────────────────────────┼─────────────────────────┼─────────────┤
│  Idempotency store      │  In-memory Set (cleared │  Redis +    │
│                         │  on restart)            │  TTL        │
├─────────────────────────┼─────────────────────────┼─────────────┤
│  Balance state          │  In-process object      │  DB row     │
│                         │  (no persistence)       │  + locking  │
├─────────────────────────┼─────────────────────────┼─────────────┤
│  Approval verification  │  Caller boolean         │  Signed JWT │
│                         │  (unverified)           │  validation │
├─────────────────────────┼─────────────────────────┼─────────────┤
│  Audit trail            │  None                   │  Append-    │
│                         │                         │  only log   │
├─────────────────────────┼─────────────────────────┼─────────────┤
│  Reconciliation         │  v1 batch (deprecated)  │  REST event │
│                         │                         │  stream     │
└─────────────────────────┴─────────────────────────┴─────────────┘
```

### Concurrency Risk

The current implementation is **not thread-safe** for concurrent transactions against the same
account. Two simultaneous calls with the same account object but different valid tokens will
both pass the `account.balance >= amount` check using the same starting balance, then both
deduct — potentially overdrawing the account despite the guard. This is a TOCTOU
(time-of-check-time-of-use) race condition that only database-level locking resolves.

---

## Prioritized Remediation Roadmap

### P0 — Immediate (blocking on production readiness)

1. **Replace in-memory token store with Redis** (resolves R-01 residual risk)
   - Use `SET token EX 86400 NX` (atomic, 24h TTL, set-if-not-exists)
   - Eliminates replay window on process restart

2. **Wrap balance mutation in a database transaction** (resolves R-04, concurrency risk)
   - `SELECT ... FOR UPDATE` or optimistic locking on the account row
   - Rollback on any failure after deduction

### P1 — Short-Term (next sprint)

3. **Replace Tier-2 boolean with signed JWT validation** (fully closes R-03)
   - Define JWT schema: `{ sub: accountId, amt: amount, exp: now+5min, iss: "tier2-service" }`
   - Validate signature, expiry, and claim match in `processTransaction`

4. **Add immutable transaction audit log** (partially closes R-04)
   - Append `{ token, amount, timestamp, balanceBefore, balanceAfter }` to a persistent log
   - Enables replay, dispute resolution, and regulatory audit

### P2 — Medium-Term (next quarter)

5. **Execute v1 → REST event streaming migration** (closes R-05)
   - Follow checklist in `docs/onboarding-guide.md §7`

6. **Introduce API versioning** (closes R-06)
   - Publish as internal npm package with semver
   - Add `v2_` namespace or versioned export object

---

*For the developer integration guide, see [`docs/onboarding-guide.md`](./onboarding-guide.md).*
*For the automated test suite validating all findings, see [`src/__tests__/account_service.test.js`](../src/__tests__/account_service.test.js).*
