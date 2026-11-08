# Shared Titan PostgreSQL database

This is the canonical database contract for Titan Central, Sorted, Skilled, and
Supercharged. PostgreSQL is the common database engine. This directory begins
the new clean-install migration chain; the old `/migrations` SQL remains
historical draft material until it is reconciled and promoted.

## Canonical tenant rule

- `titan.companies.id` is the canonical company UUID.
- Every company-owned row in app schemas uses a non-null `company_id UUID
  foreign key to `titan.companies(id)`.
- Shared identity and access records are in `titan.identities`,
  `titan.company_memberships`, `titan.application_entitlements`,
  `titan.application_company_links`, and `titan.application_user_links`.
- `titan.application_company_links` records each app's old tenant ID while it
  is migrated to the canonical company UUID.
- App-specific profile IDs remain text at the identity-link boundary to
  accommodate the current Sorted, Skilled, and Supercharged ID formats.
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

Migration `0001_shared_company_core.sql` creates the shared core only. It does
not yet move Sorted, Skilled, or Supercharged domain tables, change their
database clients, or prove RLS isolation. Do not mark the four-app database
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

