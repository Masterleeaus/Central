# Shared Titan PostgreSQL database

This is the canonical database contract for Titan Central, Sorted,
Supercharged, and LMS. The LMS source repository is `Masterleeaus/Skilled`.
PostgreSQL is the common database engine. This directory begins the new
clean-install migration chain; the old `/migrations` SQL remains
historical draft material until it is reconciled and promoted.

## Canonical tenant rule

- `titan.companies.id` is the canonical company UUID.
- Every company-owned row in app schemas uses a non-null `company_id` UUID
  foreign key to `titan.companies(id)`.
- Shared identity and access records are in `titan.identities`,
  `titan.company_memberships`, `titan.application_entitlements`,
  `titan.application_company_links`, and `titan.application_user_links`.
- `titan.application_company_links` records each app's old tenant ID while it
  is migrated to the canonical company UUID.
- App-specific profile IDs remain text at the identity-link boundary to
  accommodate the current Sorted, LMS, and Supercharged ID formats.
- Truly global reference data must be identified in the table registry; nullable
  tenant IDs must not be used to represent tenant-owned data.

## Migration authority

Central owns the ordered migration registry. App repositories contribute
reviewed SQL migrations to this chain; app-local schema pushes must not mutate
shared production objects. Each migration is applied transactionally and
recorded in `titan.schema_migrations` with a SHA-256 checksum. A future runner
must serialize migration execution, reject checksum drift, and fail on an
unknown out-of-order migration.

## Current implementation boundary

Migration `0001_shared_company_core.sql` creates the shared core only. CI applies
it to a separate clean PostgreSQL database and checks the required company UUID
foreign keys. It does not yet move Sorted, LMS, or Supercharged domain tables,
change their database clients, or prove RLS isolation. Do not mark the four-app database
upgrade production-ready until those migrations and app adapters are completed
and verified on a disposable PostgreSQL database.

## Upgrade sequence

1. Freeze and inventory all four schema sources.
2. Reconcile shared entities and table-name collisions; assign each table an
   owner and tenant/global scope in `table-registry.csv`.
3. Port app-domain DDL into one ordered chain and establish schema namespaces.
4. Update app clients, sessions, route/worker context, and access policies to
   use the canonical company UUID.
5. Verify clean install, schema drift, and cross-company isolation for all apps.


## Reconciliation work added on the Central launcher draft branch

The PR #46 clean-install schema has been copied without modifying its original
`0001_shared_company_core.sql`. This repository now has two **independent**
database test paths: the legacy `/migrations` chain (1–15) and the canonical
`database/migrations` chain. CI applies each to a separate disposable
PostgreSQL database. Do **not** apply both chains to one database: both
create `titan.identities` with incompatible column contracts
(`state` versus `status`).

Canonical migrations added:
- `0002_shared_company_rls.sql` defines the company-scoped,
  NOLOGIN read-only role `titan_shared_company_reader`, transaction-local
  company context and FORCE RLS for company, identity, membership,
  entitlement and app-link reads. An unset or malformed scope reads no rows.
- `0003_legacy_central_company_links.sql` defines a reviewed one-to-one
  mapping from legacy Central organisation UUID to canonical company UUID
  and Logto organisation ID. Pending/revoked mappings never confer access.
  There is **no automatic conversion** between UUID namespaces.

Live deployment still needs an authenticated and audited mapping approval
workflow, schema-backfill procedures, shared database role grants and
production-level canonical RLS/provisioning. The existing launcher still
uses its legacy authoritative reader. Its queries have **not** been
switched to these canonical tables, because doing so before tenant and
identity migration would risk cross-company authorization errors.

These new draft migrations are not merged to PR #46 automatically;
the PR owners must reconcile the additional migration files before
either draft becomes production-ready.

## Verified canonical company-name bridge (additional staged integration)

- `0004_verified_company_lookup.sql` exposes only a restricted
  `resolve_verified_central_company(legacy_organisation_uuid, logto_organisation_id)`
  lookup to the canonical read role. It resolves **only** reviewed
  `verified` links for active companies. The authoritative Logto
  organisation ID must match the legacy mapping.
- `apps/control-api/src/central-canonical-company-name.mjs` uses that
  resolver and then changes the transaction-local `titan.company_id`
  before reading the canonical company name. It does not accept
  browser-provided display names or assume UUIDs are interchangeable.
- `central-shared-bootstrap.mjs` checks that a **separate named
  PostgreSQL database** exists and has the canonical tables and
  approved lookup function before handing the service a trusted name
  resolver.
- When the browser feature is enabled and no trusted name callback
  was injected, `server.mjs` now requires
  `TITAN_CENTRAL_SHARED_DATABASE_URL` and initializes a second
  connection pool. Both pools are closed on successful shutdown;
  failed canonical preflight closes its pool and blocks startup.
- `central-browser-router.mjs` validates
  `TITAN_OIDC_STATE_KEY` and injects the resulting AES-256-GCM
  sealer into both OIDC and company-choice stores. No implicit
  process-env key lookup replaces the supplied service environment.

**Critical limitations:** These are transitional staging mechanics,
not the final one-database architecture. Neither database has been
backfilled or linked with verified real user/company records.
Canonical migrations remain independent from the legacy migration
chain; do not run them on the same database. The newly created
`titan_shared_company_reader` role requires explicit, approved
role-membership grants for the canonical service credential, and
the legacy Central app credential requires its own previously
documented restricted roles. No production connections, migrations
or Logto registrations were changed.

## Canonical migration execution contract — Pass 13

Use `python3 tools/migrate_shared.py --database-url "$TITAN_SHARED_DATABASE_URL"`
**only** for the clean, separately named canonical database. The runner
executes `database/migrations/0001–0004` in order and records SHA-256
checksums in the canonical `titan.schema_migrations` table, not the
legacy `public.schema_migrations` registry. It reuses the established
migration parser, per-transaction advisory lock and `psql` error handling
but has a distinct lock ID and irreversible checksum-drift checks.

Safety guards:
- Existing legacy tables or legacy migration registry are refused before
  creating any canonical object.
- Applied version/name/checksum mismatches, removed migrations and
  out-of-order pending versions are fatal.
- The initial migration creates its own canonical ledger within the
  same transaction as the schema, and its ledger record is inserted
  **before COMMIT**, not later.
- A second execution is a no-op; `--dry-run` reports pending versions
  without installing any table.
- CI uses one disposable legacy Central PostgreSQL DB and one separate
  canonical DB. It proves the canonical runner cannot run against the
  legacy DB, checks its complete SHA-256 ledger, and executes both
  families' RLS tests independently.

The existence of one authoritative canonical migration runner does
**not** mean live tenant data has been moved. The ledger is unified
for the canonical core only. Legacy Central remains on its own 15-step
migration history while company/identity backfill, provisioning,
link approval, product data and schemas, and application adapters
await a reviewed transactional migration plan. Never silently
rename `titan.identities.state` to `status`, treat unrelated
UUIDs as equal or autoapprove legacy links.

## Read-only company reconciliation audit — Pass 14

Before approving any company/identity migration, run the standalone audit
against a stable, backed-up and access-restricted staging copy of both
databases:

```bash
python3 tools/audit_company_reconciliation.py \
  --legacy-url "$TITAN_CENTRAL_DATABASE_URL" \
  --canonical-url "$TITAN_CENTRAL_SHARED_DATABASE_URL" \
  --output /secure/titan-reconciliation-report.json
```

This tool performs **read-only, repeatable-read PostgreSQL transactions**
and caps each source table extraction at 10,000 rows, rejecting larger
datasets rather than silently publishing partial findings. It reads
legacy companies, Logto identities, memberships, legacy app entitlements
and local links, then compares them with canonical companies, verified
legacy-to-company mappings, identities, memberships, canonical app
entitlements and verified application user links. The explicit product
translation is `field → sorted`, `desk → supercharged`,
`academy → lms`.

The JSON report contains **only aggregate record counts and blocker
categories**, not company IDs, Logto subjects or user identifiers.
It flags missing/pending company mappings, mismatched Logto organisation
IDs, unmatched identities, roles and membership statuses, grant state
and feature differences, missing account links, and unexpected active
canonical memberships, entitlements or verified user links.
Exit codes: `0` for no discrepancies in compared fields, `2`
for review blockers, and `1` for unavailable/invalid/oversized
audit. The output path must not already exist.

**Not a migration authorisation:** The databases cannot provide one
atomic snapshot across two PostgreSQL instances. Each table is read
in its own read-only snapshot; run the audit against quiescent,
consistent staging copies. The current audit does not prove matching
expirations, audited Logto membership authority, production data
backfill completeness, approval of source mapping or product-specific
session semantics. Even exit `0` is not a substitute for signed
migration approval and a verified, rollback-safe conversion plan.

CI seeds *different* legacy and canonical company/identity UUIDs,
asserts that only verified mappings reconcile, then deliberately
changes a member role and requires a blocking exit. Unit tests
also cover unexpected canonical grants and local user links. No
production database is queried by CI.
