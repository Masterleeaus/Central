# Central main / launcher integration — reconciliation ledger

This branch starts from current `main`. It is intentionally **not** a merge of PR #49: GitHub reports PR #49 as non-mergeable, with 353 feature-side and 100 main-side commits since the merge base `be6544f880b5a8858ce022a991a170ec294ebe2c` (measured 2026-11-12). No feature-branch source may overwrite current `main` wholesale.

## Security-critical conflict: OIDC login state

`apps/control-api/src/oidc-state-pg.mjs` on `main` executes save, consume and pruning via `withRoleTransaction(pool, 'titan_trusted_writer', ...)`, using `pool.connect()`. The PR #49 version uses direct `pool.query()` and accepts an additional `central` application ID. **Required merge:** preserve the trusted-writer role transaction for every query, then add `central` only after confirming its schema CHECK and authorization tests. Do not restore direct login-role writes.

## Runtime conflict: service entrypoint

`apps/control-api/src/server.mjs` on `main` initializes the validated product registry, link assertion key sets, PostgreSQL flag store, service config reads, Skilled decision handler and operator plane. PR #49 initializes a browser router and canonical company resolver with a second pool. **Required merge:** retain all existing initialization, inject the browser router behind its explicit flag, close both pools on startup failure and shutdown, and retain the feature branch's HTTP connection/timeouts. Add regression tests for disabled-browser behavior and every existing route.

## Runtime conflict: central handler

`apps/control-api/src/app.mjs` on `main` records activity in a separate transaction and generates UUIDs. PR #49 adds a concurrency limiter. **Required merge:** keep audit/activity persistence and apply concurrency controls without altering existing response contracts.

## Shared migration topology

PR #49's canonical `database/migrations/0001..0013` chain (including merged PR #84 Scheduled registration) must be reconciled with the existing `migrations/` chain on `main`. Never run both blindly against the same database. Confirm the target topology, upgrade sequence, role grants and rollback/restore procedure before enabling migration deployment.

## Acceptance gates

1. Reconcile the complete overlapping-file inventory against the actual merge base, preserving `main`'s newer functionality.
2. Run unit and API regression tests for OIDC, admin/operator, config read, decision service, launcher and browser routes.
3. Run both migration suites against disposable PostgreSQL with a representative pre-upgrade snapshot.
4. Prove least-privilege roles, RLS company switching, session replay rejection, and startup/shutdown pool cleanup.
5. Only then open a merge-ready PR to `main`, merge with an expected-head SHA and delete branches proven merged.

No production migration, PR #49 merge or branch deletion is authorized by this ledger.
