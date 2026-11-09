# Titan Central

Titan Central is the central identity and access-control service for Sorted, Supercharged and LMS. It keeps the identity, organisation, entitlement, verified account-link and session-revocation facts these products share. Logto remains the identity provider. The repository still uses the legacy application identifiers field, desk and academy in compatibility-sensitive interfaces; they map to Sorted, Supercharged and LMS, respectively. Tenant data stays in each application.

Status: pre-deployment. The migrations are reviewed drafts, the HTTP service is not deployed, and nothing in this repository has been applied to a live environment. Read [TITAN_ARCHITECTURE_DECISIONS.md](TITAN_ARCHITECTURE_DECISIONS.md) for the decisions and [PASS15_DEPLOYMENT_RUNBOOK.md](PASS15_DEPLOYMENT_RUNBOOK.md) for the gates that must pass before any deployment.

## Components

| Path | What it is |
| --- | --- |
| `apps/control-api` | Node 22 ESM HTTP service (`src/server.mjs`). Verifies OIDC tokens, checks access through the control-plane library, and stores OIDC login state and session revocations in PostgreSQL. Binds to loopback only. |
| `packages/control-plane` | TypeScript authorization library (`src/`). Resolves app-scoped roles, entitlements and local-account links. Compiled output is committed in `dist/`; see below. |
| `migrations` | Ordered SQL migrations for the dedicated `titan_central` PostgreSQL database. |
| `tools` | `migrate.py`, the migration runner, and `verify_logto_source.py`, a read-only checker for a supplied Logto source archive. |
| `deploy` | `preflight.py`, a read-only readiness assessor for a staging configuration, and `staging.example.json`, an example that must report not ready. |
| `tests` | Python tests for `tools/`, the migration runner, and `tests/sql/rls_two_tenant.sql`, the two-tenant row-level security test. |
| `deploy/tests` | Python tests for `deploy/preflight.py`. |

## Build and test

Requirements: Node.js 22 or later, Python 3.13 (3.10 or later should work), and `psql` for database steps.

```bash
# Dependencies come from the committed lockfiles.
(cd apps/control-api && npm ci && node --test test/*.test.mjs)
(cd packages/control-plane && npm ci && npx tsc -p tsconfig.json && node --test test/*.test.mjs)

# Python
python3 -m unittest discover -s deploy/tests -p 'test_*.py'
python3 -m unittest discover -s tests -p 'test_*.py'
```

CI (`.github/workflows/ci.yml`) runs all of the above, plus the dist-freshness check, the preflight check mode, and the database steps against a PostgreSQL 16 service container.

### Database steps

```bash
export DATABASE_URL='postgresql://USER@HOST:5432/titan_central'   # never commit a real URL
python3 tools/migrate.py --database-url "$DATABASE_URL"            # apply pending migrations
python3 tools/migrate.py --database-url "$DATABASE_URL" --dry-run  # list pending only
psql -v ON_ERROR_STOP=1 -f tests/sql/rls_two_tenant.sql "$DATABASE_URL"  # superuser; test database only
```

The RLS test seeds two tenants and runs inside a transaction that is rolled back. Run it only against a disposable database, never a live one.

## Migrations

- Files are `migrations/NNNN_name.sql` and are applied in ascending version order.
- Every file is one transaction: it starts with `BEGIN;` and ends with `COMMIT;`. The runner rejects files that do not.
- `tools/migrate.py` records each applied migration in `public.schema_migrations` (version, name, sha256 checksum, applied time). The record is written inside the migration's own transaction.
- Re-running is safe. The runner refuses to continue if an applied file has changed on disk, if an applied version has no file, or if a pending version sits below an applied one.
- Applied migrations must never be edited. Add a new numbered file instead.

| Migration | Purpose |
| --- | --- |
| 0001 | Core tables in schema `titan`: identities, organisations, memberships, entitlements, local account links. |
| 0002 | Provisioning audit table. |
| 0003 | OIDC login-state table (created unqualified, moved by 0005). |
| 0004 | Session-revocation table (created unqualified, moved by 0005). |
| 0005 | Moves the 0003 and 0004 tables into schema `titan`. Application queries use `titan.<table>`. |
| 0006 | Row-level security on `titan.memberships`, `titan.entitlements`, `titan.local_account_links`. |
| 0007 | Provisioning audit types for update and revoke commands; session-revocation and OIDC-state grants. |
| 0008 | Trusted reader scoped to the organisation set for the transaction; `titan_trusted_writer` may read session revocations (needed by the revocation bump). |
| 0009 | Login-role grants for the control-api stores: `titan_trusted_writer` may SELECT the OIDC login-state columns that consume and prune read. Nothing is granted to the login role itself. |
| 0015 | Subscription lifecycle ledger (issue #35): `titan.billing_subscriptions` (last applied position per provider subscription) and `titan.billing_events` (one row per verified provider event, with its disposition). Written only by `titan_trusted_writer`. Numbers 0010-0014 are unused. See `docs/SUBSCRIPTIONS.md`. |

Tenant isolation (0006, narrowed by 0008). Tenant scope is the transaction-local setting `titan.organisation_id`. Set it with a bound parameter, never by interpolation: `SELECT set_config('titan.organisation_id', $1, true)`. This has the same effect as `SET LOCAL` and is the only form that takes a bind parameter. With no scope set, tenant rows are invisible and writes fail (fail closed). A malformed value raises an error.

Role design. Each role is a NOLOGIN group role. The deployment creates one login role for the service and grants it the two trusted roles. The login role must not be a superuser, must not have `BYPASSRLS`, and must be `NOINHERIT`:

```sql
CREATE ROLE titan_central_app LOGIN NOINHERIT PASSWORD '<from the secret store>';
GRANT titan_trusted_reader, titan_trusted_writer TO titan_central_app;
-- Do not grant titan_tenant_app to the service; it is for a future tenant-facing role only.
-- Do not make titan_central_app the owner of any titan.* object.
```

- `titan_trusted_reader` runs the access check (`withCentralReadSnapshot`). It runs `SET LOCAL ROLE titan_trusted_reader`, then sets the organisation scope. It reads identities and organisations (global, not RLS-protected). It reads memberships, entitlements and local account links only for the organisation in scope.
- `titan_trusted_writer` runs provisioning (`CentralProvisioner`). It runs `SET LOCAL ROLE titan_trusted_writer` and is cross-tenant by design. Every command is separately authorised and writes one audit row in the same transaction.
- `titan_tenant_app` is tenant-scoped on the three tables and has no grant on identities, organisations or session revocations.

Verified on PostgreSQL 16 with `tests/sql/rls_two_tenant.sql` (run as superuser) and `tests/sql/login_role_path.sql` (run as superuser, which becomes `titan_central_app` for its checks). The session-revocation store (`apps/control-api/src/session-revocation-pg.mjs`) and the OIDC state store (`oidc-state-pg.mjs`) run each statement in a transaction that does `SET LOCAL ROLE titan_trusted_reader` or `titan_trusted_writer` (`role-transaction.mjs`); migration 0009 grants the writer the SELECT that consume and prune need. Still not covered: `titan.titan_session_revocations` and `titan.titan_oidc_login_states` have no RLS. Their statements are restricted by role and by key, not by organisation.

Running the login-role path test (`tests/test_login_role_path.py`): it runs only when `psql` and `TITAN_TEST_DATABASE_URL` are present, otherwise it is skipped with the reason printed. The database must hold migrations 0001-0009 and no tenant rows, and the URL should be a superuser URL for that database:

```bash
python3 tools/migrate.py --database-url "$TITAN_TEST_DATABASE_URL"
python3 -m unittest discover -s tests -p 'test_login_role_path.py' -v
```

CI runs this against its PostgreSQL 16 service with `TITAN_REQUIRE_DB_TESTS=1`, so a skip fails the job.

## Compiled output (`packages/control-plane/dist`)

`apps/control-api` imports `packages/control-plane/dist/`, which is generated from `src/` and committed. `dist/` is not edited by hand. After any change to `packages/control-plane/src`, rebuild and commit the result:

```bash
cd packages/control-plane && npx tsc -p tsconfig.json
```

CI builds into a scratch directory and fails if the committed `dist/` differs from a fresh build. Changing `src` without rebuilding will fail CI.

## Environment variables

Names only. Values are supplied by the deployment environment and must never be committed.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `TITAN_CENTRAL_DATABASE_URL` | control-api (required) | PostgreSQL connection string for the `titan_central` database. |
| `TITAN_OIDC_ISSUER` | control-api (required) | Expected token issuer (the Logto OIDC issuer). |
| `TITAN_FIELD_AUDIENCE` | control-api (required) | Expected audience for Sorted (legacy application ID: `field`). |
| `TITAN_DESK_AUDIENCE` | control-api (required) | Expected audience for Supercharged (legacy application ID: `desk`). |
| `TITAN_ACADEMY_AUDIENCE` | control-api (required) | Expected audience for LMS (legacy application ID: `academy`). |
| `TITAN_OIDC_STATE_KEY` | control-api (required for browser login state) | Base64-encoded 32-byte key used to seal short-lived OIDC state. |
| `TITAN_OIDC_JWKS_URI` | control-api (required) | JWKS endpoint used to verify token signatures. |
| `TITAN_CENTRAL_PORT` | control-api (optional) | Loopback port. Defaults to 3102. |
| `TITAN_CI_DATABASE_URL` | CI only | Throwaway PostgreSQL URL for the database steps in CI. |

`tools/migrate.py` takes its database URL as `--database-url`, not from an environment variable.

## Run

```bash
cd apps/control-api && npm start   # requires the control-api variables above
```

## Further reading

- [TITAN_ARCHITECTURE_DECISIONS.md](TITAN_ARCHITECTURE_DECISIONS.md): architecture decisions ADR-001 to ADR-007.
- [PASS15_DEPLOYMENT_RUNBOOK.md](PASS15_DEPLOYMENT_RUNBOOK.md): integration and production go/no-go gates.
- [deploy/OPERATIONS.md](deploy/OPERATIONS.md): systemd template installation, secret storage, service operations and rollback.
- [packages/control-plane/README.md](packages/control-plane/README.md): the authorization library's trust boundaries.
