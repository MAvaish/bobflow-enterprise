# Onboarding Guide — Account Service

> This file is a root-level alias for [`docs/onboarding-guide.md`](docs/onboarding-guide.md).
> The full onboarding guide, architecture diagrams, and migration walkthroughs live there.

---

## Quick Navigation

| Section | Link |
|---------|------|
| System Overview & Compliance Matrix | [docs/onboarding-guide.md §1](docs/onboarding-guide.md#1-system-overview) |
| Architecture Sequence & Flow Diagrams | [docs/onboarding-guide.md §2](docs/onboarding-guide.md#2-architecture-diagram--request-lifecycle) |
| API Reference — `processTransaction` | [docs/onboarding-guide.md §3](docs/onboarding-guide.md#3-entry-points--api-reference) |
| Data Mutation Map | [docs/onboarding-guide.md §4](docs/onboarding-guide.md#4-data-mutation-map) |
| Idempotency Token Guide | [docs/onboarding-guide.md §5](docs/onboarding-guide.md#5-idempotency-token-guide) |
| Tier-2 Approval Flow & Diagrams | [docs/onboarding-guide.md §6](docs/onboarding-guide.md#6-tier-2-approval-flow) |
| v1 Batch → REST Streaming Migration | [docs/onboarding-guide.md §7](docs/onboarding-guide.md#7-v1-batch-reconciliation-migration) |
| Quick-Start Code Snippet | [docs/onboarding-guide.md §8](docs/onboarding-guide.md#8-quick-start-code-snippet) |
| System Dependencies Table | [docs/onboarding-guide.md §9](docs/onboarding-guide.md#9-system-dependencies) |

---

## At a Glance — Entry Point

```javascript
const { randomUUID } = require('crypto');
const { processTransaction } = require('./src/account_service');

const account = { id: 'ACC-001', status: 'ACTIVE', balance: 5000 };
const token   = randomUUID();

const result = processTransaction(account, 250, token, false);
// => { status: 'COMPLETED', remainingBalance: 4750 }
```

See the full guide for error handling, high-value transactions, and the migration path away
from v1 fixed-width batch reconciliation.

---

*Security findings and the remediation roadmap: [`MODERNIZATION_AUDIT.md`](MODERNIZATION_AUDIT.md)*
*Automated test suite: [`src/__tests__/account_service.test.js`](src/__tests__/account_service.test.js)*
