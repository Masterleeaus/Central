# Issue #38 evidence: centrally governed configuration and feature flags

Recorded 2026-11-18 against origin/main 9dcd603. Implementation landed in PR #54 (commit e269e28).

| Acceptance criterion | Evidence in repo |
| --- | --- |
| Flags have explicit owners, types, defaults and allowed values | `packages/control-plane/src/feature-flags.ts` rejects a declaration with no owner, a default outside its type or allowed values, and an undeclared flag. Tests: "registry rejects a flag that was never declared", "registry rejects a declaration whose default is outside its type or allowed values". |
| Changes are audited and can be rolled back | Writes record actor and reason and bump a revision; history is append-only. Tests: "a change ... records actor and reason", "the history is append-only", "rollback restores a previous value as a new revision". |
| Products fail safely when Central is unavailable or returns an invalid configuration | Declared default served with a reason when the store is down, times out, or returns an invalid value. Tests: "store unavailable", "store that never answers", "an invalid stored value never reaches the caller". |
| Tenant targeting is verified server-side and cannot be overridden by client input | Resolver refuses client-supplied organisation or tenant fields and any context not from `trustVerifiedContext`. Tests: "the resolver refuses a client-supplied organisation or tenant field", "the resolver refuses a context that did not come from trustVerifiedContext". |
| Tests cover environment separation, staged rollout, expiry and rollback | Tests: "environments are separate", "a rollout row serves its value only to organisations inside the bucket", "bucketing is monotonic", "an expired organisation override falls back", "rollback refuses an unknown revision". |

Command run: `cd packages/control-plane && node --test test/feature-flags.test.mjs` gives 34 tests, 34 pass, 0 fail.

Not covered by this record: the PostgreSQL-backed suite (`apps/control-api/test/feature-flags-postgres.test.mjs`) needs a disposable database and was not run here. The authenticated server-to-server read endpoint is not separately verified in this record.
