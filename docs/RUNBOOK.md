# Titan Central API runbook (DRAFT)

Status: **draft for review.** It describes the steps the repository supports today. Several gates are still open, so this release is **not production-installable** until they are closed (see "Gates before go-live"). Do not follow this runbook against a live Desk, Field or Academy directory.

## What runs

| Component | Path | Notes |
| --- | --- | --- |
| Central API | `apps/control-api` | Node 22, ESM. Listens on `127.0.0.1:3102` only. |
| Control plane | `packages/control-plane` | TypeScript. Committed `dist/` is imported by the API; rebuild it when `src/` changes. |
| Migrations | `migrations/`, `tools/migrate.py` | Forward-only, applied to the separate `titan_central` database. |
| Service unit | `deploy/central.service` | Template with placeholders. Not installed by the repository. |
| Environment | `deploy/env.example` | Template. Real values live on the server only. |

Logto is the upstream identity service. It is not in this repository. See `docs/UPSTREAM.md`.

## Prerequisites

- Node.js 22 or later on the server (the API's `engines` field requires it).
- An isolated, supported PostgreSQL instance for `titan_central`, separate from Logto and from the Desk and Field databases (ADR-003). The live host's PostgreSQL 13.23 must not be used.
- A pinned, verified Logto release reachable over HTTPS (see `docs/UPSTREAM.md`).
- Three Logto applications (Desk, Field, Academy), each with its own confidential client and its own audience.

## Secrets

- Keep all secrets in `/etc/titan-central/central.env`, owned by `root:root`, mode `0600`. Create it from `deploy/env.example`.
- Never place secrets in the repository, a ZIP, the unit file, shell history or chat.
- `TITAN_OIDC_STATE_KEY` is a random 32-byte value, base64-encoded: `openssl rand -base64 32`. Generate it on the server. Rotating it, or losing it, makes in-flight logins fail closed. Plan rotation for a quiet period.
- Use a restricted PostgreSQL role for the service. Do not use the Logto, Desk or Field database owners.

## Install a release

Releases are immutable directories. Never extract a ZIP over a live application directory (ADR-007).

```bash
RELEASE=/opt/titan-central/releases/<tag>
# Copy the tagged source into $RELEASE, then:
cd $RELEASE/apps/control-api && npm ci --omit=dev
cd $RELEASE/packages/control-plane && npm ci && npx tsc -p tsconfig.json
```

Check that `packages/control-plane/dist` matches a fresh build. CI enforces this on every push and pull request.

## Database

1. Create a dedicated database `titan_central` on the isolated PostgreSQL instance. Create the LOGIN users the service needs and grant them the `titan_trusted_reader` or `titan_trusted_writer` role. Migration 0006 creates those roles as `NOLOGIN`.
2. Take a backup before any migration, and keep it until the release is confirmed.
3. Dry run, then apply. Pass the URL without a password and use `PGPASSFILE` for credentials:

```bash
python3 tools/migrate.py --database-url "postgresql://<user>@<host>:<port>/titan_central" --dry-run
python3 tools/migrate.py --database-url "postgresql://<user>@<host>:<port>/titan_central"
```

The runner refuses a migration that is not one transaction, and it refuses a changed checksum. Migrations are forward-only, so undoing one means restoring the backup.

## Start, stop, restart, status

```bash
sudo install -m 0644 $RELEASE/deploy/central.service /etc/systemd/system/titan-central.service   # after filling placeholders
sudo systemctl daemon-reload
sudo systemctl enable --now titan-central
sudo systemctl restart titan-central
sudo systemctl stop titan-central
systemctl status titan-central
journalctl -u titan-central -n 200
```

`SIGTERM` closes the HTTP server and the database pool before exit. The unit allows 20 seconds for that.

Health check, on the server only:

```bash
curl -s http://127.0.0.1:3102/healthz    # 200 {"status":"ok"} when the database answers, 503 otherwise
```

## Rollback

1. Keep the previous release directory until the new one is confirmed.
2. Point `WorkingDirectory` and `ExecStart` in the unit at the previous release, then `systemctl restart titan-central`.
3. If the new release applied a migration, the database is not rolled back automatically. Restore the pre-migration backup only if the schema change itself is the problem, and only with a reviewed plan.

Do not delete identity mappings or drop databases during a failed cutover (PASS15).

## Operating limits and known gaps

- The admin provisioning route is **not mounted** by default. Enabling it needs the operator organisation ID and admin role IDs (issue #3).
- Rate limits in the process reset on restart and are per instance. Production limits must also be set at the reverse proxy (issue #5).
- Tenant row-level security is in place on three tables, but the application does not yet set the tenant context per request. Do not treat RLS as enforced in production until that is done (issue #7).
- Global logout is implemented as a module but not wired to a route (issue #6).
- Access checks return only `allowed`, `role` and `reason`. Consumers must not expect identity IDs.

## Gates before go-live

Run the read-only gate and resolve every issue it reports:

```bash
python3 deploy/preflight.py --config deploy/staging.example.json --root <repo> --upstream <pinned-logto-path>
```

The gate is expected to fail until the following are recorded with evidence: a supported PostgreSQL, a verified pinned Logto, live OIDC client registrations, each application adapter in use (Desk, Field; Academy is deferred), two-tenant tests against the real database, global logout, and a rehearsed rollback. Do not set a flag to `true` without that evidence.
