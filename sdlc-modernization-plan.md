# SDLC Modernization Plan — Account Service

## Top-Level Overview

**Goal:** Modernize `src/account_service.js` to close four compliance gaps identified against
`legacy_specs.txt`, produce developer-facing documentation (onboarding guide + architecture
diagrams), publish a security-and-risk audit report, and ship an automated edge-case unit test
suite — all as net-new files with minimal, targeted changes to the existing source.

**Scope:**
- `src/account_service.js` — targeted business-logic fixes only (no structural rewrite)
- `docs/onboarding-guide.md` — new interactive onboarding guide with ASCII/Mermaid architecture diagrams
- `docs/security-risk-audit.md` — new modernization and security risk audit report
- `src/__tests__/account_service.test.js` — new automated edge-case unit test suite

**Non-goals:**
- No framework migration (Express, Fastify, etc.)
- No database layer changes
- No CI/CD pipeline changes
- No changes to README.md or SECURITY.MD

---

## Sub-Task 1 — Fix Compliance Gaps in `account_service.js`

**Status:** `[x] done`

**Intent:**
Close the four compliance violations surfaced by cross-referencing `legacy_specs.txt` against
the current implementation. Each fix is minimal and surgical — no architectural changes.

**Compliance Gaps to Address:**

1. **Non-negative balance check (Spec §1):** After `account.balance -= amount`, the balance can
   go negative. Add a pre-deduction guard: if `account.balance < amount`, throw a descriptive
   error before mutating state.

2. **Idempotency token (Spec §3):** `processTransaction` accepts no idempotency token. Add an
   `idempotencyToken` parameter. If the token is absent or falsy, throw an error. A simple
   in-memory `Set` (or passed-in token store) is sufficient to detect duplicate submissions for
   this scope.

3. **Tier-2 approval is unverified (Spec §2):** The `requiresApproval` flag is a raw boolean
   supplied by the caller with no verification. Rename the parameter intent to
   `tier2ApprovalVerified` and add an inline comment marking it as a required verified claim.
   The actual verification call (e.g., an HTTP call to an approval service) is out of scope but
   must be documented as a TODO placeholder in code.

4. **v1 batch reconciliation pattern (Spec §4 — Deprecation Notice):** No batch reconciliation
   code currently exists in `account_service.js`, so no removal is needed. Add a module-level
   JSDoc deprecation notice block stating that any consumer still calling fixed-width batch
   reconciliation (v1) must migrate to REST event streaming, pointing to the onboarding guide.

**Expected Outcomes:**
- `processTransaction` throws if balance would go negative
- `processTransaction` throws if no idempotency token is provided
- `processTransaction` throws on duplicate idempotency token (re-submission guard)
- Parameter name and inline TODO make the Tier-2 approval gap explicit and traceable
- Module-level deprecation comment documents the v1 batch migration requirement

**Todo List:**
1. Read the current `src/account_service.js` to confirm exact line content before editing
2. Add `idempotencyToken` as a third parameter; add a processed-tokens `Set` at module scope
3. Add guard: throw if `!idempotencyToken`
4. Add guard: throw if `processedTokens.has(idempotencyToken)` (duplicate)
5. Rename `requiresApproval` → `tier2ApprovalVerified`; add TODO comment
6. Add pre-deduction balance guard: throw if `account.balance < amount`
7. After successful completion, add `processedTokens.add(idempotencyToken)`
8. Add module-level JSDoc block for v1 batch reconciliation deprecation notice
9. Update `module.exports` to also export `processedTokens` (for test reset)

**Relevant Context:**
- [`src/account_service.js`](src/account_service.js) — full file, 16 lines
- `legacy_specs.txt` — all four spec items drive this sub-task

---

## Sub-Task 2 — Create `docs/onboarding-guide.md`

**Status:** `[x] done`

**Intent:**
Produce an interactive developer onboarding guide that explains the system architecture,
entry points, data flow, and how to consume `account_service.js` correctly — including
idempotency token usage, Tier-2 approval flow, and the v1→REST streaming migration path.
Visual architecture diagrams use Mermaid so they render in GitHub and modern doc platforms.

**Expected Outcomes:**
- New file `docs/onboarding-guide.md` exists
- Contains: system overview, architecture diagram (request lifecycle), data mutation diagram,
  Tier-2 approval flow diagram, idempotency token usage example, v1→REST migration section,
  and a quick-start code snippet

**Todo List:**
1. Create `docs/` directory (implicit via file creation)
2. Write `docs/onboarding-guide.md` with the following sections:
   - **Overview** — what the account service does, its role in the enterprise system
   - **Architecture Diagram** — Mermaid sequence diagram: caller → processTransaction → approval gate → balance mutation → response
   - **Entry Points** — document `processTransaction(account, amount, idempotencyToken, tier2ApprovalVerified)`
   - **Data Mutation Map** — describe `account.balance` as the sole mutable field, in-place mutation risk, and idempotency guard
   - **Idempotency Token Guide** — how to generate, pass, and what errors to expect on re-use
   - **Tier-2 Approval Flow** — diagram and description of the $10k threshold, what `tier2ApprovalVerified` means, TODO for external approval service integration
   - **v1 Batch Reconciliation Migration** — side-by-side: deprecated fixed-width batch pattern vs. REST event streaming target pattern (pseudo-code)
   - **Quick-Start Code Snippet** — minimal correct usage example in JavaScript

**Relevant Context:**
- [`src/account_service.js`](src/account_service.js) — post Sub-Task 1 state is the reference
- `legacy_specs.txt` — all four spec items must be addressed in the guide

---

## Sub-Task 3 — Create `docs/security-risk-audit.md`

**Status:** `[x] done`

**Intent:**
Produce a formal, structured security and modernization risk audit report that an engineering
manager or security reviewer can act on. It must reference specific line numbers in the
source, classify risks by severity, and recommend remediation steps for each finding.

**Expected Outcomes:**
- New file `docs/security-risk-audit.md` exists
- Contains: executive summary, findings table (severity × finding × location × remediation),
  detailed write-ups for each finding, modernization risk section, and a prioritized remediation roadmap

**Findings to Document (pre-researched):**

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| R-01 | HIGH | No idempotency enforcement — duplicate submissions cause double-spend | `account_service.js` line 12 (pre-fix) |
| R-02 | HIGH | Balance can go negative — no pre-deduction guard | `account_service.js` line 12 (pre-fix) |
| R-03 | MEDIUM | Tier-2 approval is caller-asserted boolean — no cryptographic or service verification | `account_service.js` line 9 |
| R-04 | MEDIUM | In-place object mutation — no transaction rollback or audit trail | `account_service.js` line 12 |
| R-05 | LOW | v1 fixed-width batch reconciliation still referenced in specs — no migration path exists in code | `legacy_specs.txt` line 4 |
| R-06 | LOW | `module.exports` exports only one symbol — no versioning or deprecation signaling on the public API | `account_service.js` line 16 |

**Todo List:**
1. Create `docs/security-risk-audit.md`
2. Write Executive Summary section
3. Write Findings Table (all six R-xx items)
4. Write detailed Finding Write-Ups (one section per finding: description, risk, evidence, remediation)
5. Write Modernization Risk section: in-place mutation architecture, lack of event sourcing, no audit log
6. Write Prioritized Remediation Roadmap (P0/P1/P2 tiers)

**Relevant Context:**
- [`src/account_service.js`](src/account_service.js) — line references for all findings
- `legacy_specs.txt` — compliance baseline for R-01 through R-05
- Sub-Task 1 fixes close R-01, R-02, R-03 partially, and R-05 partially; the audit report should reflect the *pre-fix* state as discovered findings and note which are resolved by Sub-Task 1

---

## Sub-Task 4 — Create `src/__tests__/account_service.test.js`

**Status:** `[x] done`

**Intent:**
Produce a comprehensive, automated edge-case unit test suite using Node's built-in `assert`
module (zero external dependencies required). Tests must cover every compliance requirement
from `legacy_specs.txt` and every code path in `account_service.js` — including the new
guards added in Sub-Task 1.

**Expected Outcomes:**
- New file `src/__tests__/account_service.test.js` exists
- All tests are self-contained and runnable with `node src/__tests__/account_service.test.js`
  (no Jest/Mocha required, though the structure is compatible with both)
- Coverage includes: happy path, all throw conditions, boundary values, idempotency re-use, balance boundary

**Test Cases to Cover:**

| # | Category | Description |
|---|----------|-------------|
| T-01 | Happy path | Valid active account, positive amount under $10k, valid token → COMPLETED |
| T-02 | Account validation | Null account → throws |
| T-03 | Account validation | Account with status !== 'ACTIVE' → throws |
| T-04 | Amount validation | Amount = 0 → throws |
| T-05 | Amount validation | Negative amount → throws |
| T-06 | Balance guard | Amount exceeds balance → throws (R-02 fix) |
| T-07 | Balance guard | Amount exactly equals balance → COMPLETED, balance = 0 |
| T-08 | Idempotency | No token provided → throws (R-01 fix) |
| T-09 | Idempotency | Duplicate token re-used → throws (R-01 fix) |
| T-10 | Idempotency | Two different tokens for same account → both succeed independently |
| T-11 | Tier-2 approval | Amount > $10k, `tier2ApprovalVerified` = false → PENDING_APPROVAL |
| T-12 | Tier-2 approval | Amount > $10k, `tier2ApprovalVerified` = true → COMPLETED |
| T-13 | Tier-2 approval | Amount exactly $10,000 → COMPLETED (boundary: $10k is not > $10k) |
| T-14 | Tier-2 approval | Amount = $10,001 without approval → PENDING_APPROVAL |
| T-15 | Mutation | Successful transaction mutates `account.balance` correctly |

**Todo List:**
1. After Sub-Task 1 is complete, read the updated `src/account_service.js` to confirm exact exports and parameter names
2. Create `src/__tests__/` directory (implicit via file creation)
3. Write test harness (minimal `assert`-based runner with pass/fail reporting)
4. Implement T-01 through T-15 as individual named test functions
5. Ensure `processedTokens` is cleared between tests that reuse tokens (using the exported Set)
6. Add a final summary that prints pass/fail counts

**Relevant Context:**
- [`src/account_service.js`](src/account_service.js) — must be read post Sub-Task 1 before writing tests
- `legacy_specs.txt` — each spec item maps to at least one test case
- Sub-Task 1 must be complete before this sub-task begins (tests depend on the new parameter signatures)
