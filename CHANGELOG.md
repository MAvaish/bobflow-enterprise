# Changelog — BobFlow Enterprise

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0] — Phase 3 Platform Upgrade

### Added
- **WebSocket real-time telemetry** (`ws://localhost:3000/ws`) — RFC 6455 framing, zero external dependencies.
  - Broadcasts JSON frames on events: `audit`, `scan_complete`, `governance_refresh`, `ws_connect`.
  - Server-side implementation in `server.js`: `wsHandshake`, `wsEncodeFrame`, `wsSend`, `wsBroadcast`, `wsHandleFrame`.
- **`GET /api/history`** — in-session audit event log (FIFO ring buffer, 200-entry cap); supports `?limit=N` query param.
- **`GET /api/ws-info`** — endpoint metadata for WebSocket channel (client count, protocol, event list).
- **`VERSION` file** — machine-readable single-line semver, read at server startup; fallback `2.1.0` if absent.
- **`CHANGELOG.md`** (this file) — full chronological change history.
- **CI/CD lint gate** (Job 4 in `.github/workflows/bob-sdlc-governance.yml`) — enforces no `eval()`, no `console.log` in `account_service.js`, and confirms `processedTokens` Set is exported.
- **Dashboard `ROW 8`** (`public/index.html`) — Live WebSocket Telemetry Feed panel with auto-connect, reconnect backoff, JSON event stream, and connection status indicator.
- **`auditEvent()` emitter** — wraps every API handler; all events are persisted to `auditLog[]` and pushed to all WebSocket subscribers simultaneously.

### Changed
- `server.js` — `module.exports` expanded from `server` to `{ server, auditLog, wsBroadcast }` for test and integration access.
- `server.js` — startup banner now displays version and all 7 endpoints including WebSocket.
- `server.js` — `/api/scan` and `/api/governance` handlers now wrapped to emit audit events without modifying original handler logic.
- `.github/workflows/bob-sdlc-governance.yml` — added Job 4 (`static-lint`) as parallel gate alongside test-suite and spec-compliance.

### Fixed
- `module.exports = server` (bare object) changed to named-export object — prevents silent breakage if `server` is used as `require('…').server` downstream.

---

## [2.0.0] — Initial Autonomous SDLC Modernization Release

### Added
- `src/account_service.js` — 4 compliance fixes applied against `legacy_specs.txt`:
  - §1: ACTIVE status guard + non-negative balance check.
  - §2: Tier-2 Manager approval gate for transactions exceeding $10,000 (`tier2ApprovalVerified` parameter).
  - §3: Mandatory idempotency token parameter + `processedTokens` Set for double-spend prevention.
  - §4: Deprecation notice for v1 fixed-width batch reconciliation; migration path documented.
- `src/__tests__/account_service.test.js` — 15 edge-case assertions (zero external dependencies).
- `src/watsonx_governance.js` — IBM watsonx.ai / Granite LLM compliance payload builder.
- `docs/onboarding-guide.md` — 5 Mermaid architecture diagrams, full API reference, migration guide.
- `docs/security-risk-audit.md` — 6 security findings (R-01–R-06), P0/P1/P2 remediation roadmap.
- `server.js` — zero-dependency HTTP server with 4 REST endpoints.
- `bin/bobflow.js` — CLI with `scan`, `test`, `serve`, `governance`, `help` sub-commands.
- `mcp/server.js` — JSON-RPC 2.0 stdio MCP server with 3 tools: `scan_repository`, `generate_onboarding_guide`, `verify_test_suite`.
- `public/index.html` — 3D glassmorphism enterprise command-center dashboard.
- `.github/workflows/bob-sdlc-governance.yml` — 3-job CI/CD governance gate (test, spec-compliance, PR summary).
- `package.json` — scripts (`test`, `start`, `scan`, `governance`) and `bin` registration.
- `EXECUTION_SUMMARY.md` — full autonomous session audit log.
- `ONBOARDING.md`, `MODERNIZATION_AUDIT.md` — root-level aliases to docs/.
- `sdlc-modernization-plan.md` — all 4 plan sub-tasks marked complete.

### Security
- **R-01 REMEDIATED**: Double-spend risk eliminated via idempotency token enforcement.
- **R-02 REMEDIATED**: Overdraft risk eliminated via pre-deduction balance guard.
- **R-03 PARTIAL**: Tier-2 approval boolean noted for future JWT upgrade (P1 roadmap).

---

## [1.0.0] — Legacy Baseline (pre-modernization)

### Known Issues (all addressed in v2.0.0)
- No idempotency enforcement — double-spend attack surface present.
- Account balance could go negative — overdraft risk on concurrent calls.
- No Tier-2 approval verification — unvalidated boolean flag.
- No test coverage — zero unit assertions.
- v1 fixed-width batch reconciliation active — no migration path documented.
- No API versioning or deprecation signaling.
