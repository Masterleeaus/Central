# Shared database migration ownership — PR #46 / Issue #43

The canonical company schema is authored on separate open PR #46 at
`database/migrations/0001_shared_company_core.sql`; it is intentionally
NOT copied or reimplemented in PR #50. Config migrations remain CI-only
drafts until issue #43 establishes one forward-only migration chain.

The canonical schema contract checks company, identity, membership,
application-entitlement, legacy company/user mapping tables and the
schema migration ledger. It also requires the configuration grant's
foreign key to canonical companies. The current disposable PostgreSQL
fixtures contain only a subset of those tables and are not evidence that
the full canonical migration has run.

Never switch on configuration merely because CI passed; the migration
approval gate requires a separately reviewed deployment decision.
