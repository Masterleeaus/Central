# Configuration engine — Issue #38

This is a **review-only, non-deployed** feature/configuration module on draft PR #50.
Do not use feature flags for authorisation decisions: each product must verify
its own entitlements, membership and object-level permissions.

## Test

Node.js 22+ is required. No third-party dependencies.

```sh
node --test packages/config-engine/test/*.test.mjs
```

## Persistence

`sql/0001_config_engine.sql` creates scoped, versioned override and audit
tables in `titan_config`. It is a **draft migration**, not part of the
single authoritative Titan migration sequence (Issue #43). Do not apply it
against an existing production DB or through app-specific schema push.

`createPgConfigStore` serialises each override scope using a transaction
and `SELECT ... FOR UPDATE`; conflicts roll back the revision, head
and audit together. Rollback publishes a new revision, preserving history.
In-memory flag evaluation prioritises company > cohort > environment and
ignores expired overrides.

**Security gates still pending:** PostgreSQL restricted roles and grants,
tenant-scoped authenticated service read RPC, server-derived company/cohort
context, cross-tenant integration tests, migration reconciliation, and a
production-safe outage policy. The store accepts a trusted backend pool only;
it must not be exposed directly to public HTTP requests.
