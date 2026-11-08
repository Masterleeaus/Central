# Titan Central

Titan Central is the central identity, organisation, entitlement, and access-control service for Sorted, Supercharged, and LMS. This repository contains Central's API, control-plane package, PostgreSQL migrations, and deployment preflight tooling.

## Repository status

This is source code and deployment planning. The checked-in example configuration deliberately blocks readiness. A passing local source preflight does not prove that Logto, PostgreSQL, product adapters, SSO, tenant isolation, or production rollback have been verified. See [PASS 15 deployment and integration handoff](PASS15_DEPLOYMENT_RUNBOOK.md) before any deployment.

## Components

- `apps/control-api`: Node.js HTTP API for health and central access checks.
- `packages/control-plane`: TypeScript domain, OIDC/Logto, provisioning, and PostgreSQL code used by the API.
- `migrations`: draft Central control-plane schema changes; these are not a production migration history yet.
- `deploy/preflight.py`: read-only deployment evidence gate. It does not read secrets or change services.
- `deploy/staging.example.json`: non-secret example configuration with readiness evidence set to false.
- `TITAN_ARCHITECTURE_DECISIONS.md` and `PASS*_*.md`: architecture decisions and implementation/release records.

## Requirements

- Node.js 22 or newer.
- Python 3 for deployment preflight checks.
- PostgreSQL support and an isolated database are required for runtime persistence; the live deployment and database are not verified by this repository alone.

## Local checks

Install each package's dependencies before running its scripts:

```sh
cd packages/control-plane
npm install
npm test
cd ../../apps/control-api
npm install
npm test
cd ../..
python3 -m unittest discover -s deploy/tests
python3 -m unittest discover -s tests
```

The control-plane test script compiles TypeScript before running its Node.js tests. The API package test script runs its Node.js test files.

## Running the API

The API process requires these environment variables:

- `TITAN_CENTRAL_DATABASE_URL`
- `TITAN_OIDC_ISSUER`
- `TITAN_OIDC_AUDIENCE`
- `TITAN_OIDC_JWKS_URI`
- Optional: `TITAN_CENTRAL_PORT` (defaults to `3102`)

Keep secrets in the deployment environment; never commit real credentials. The current API binds to loopback. Product-specific browser sessions and live Central SSO adapters must be integrated and verified separately.

## Deployment gate

Run the source and evidence checks from the repository root:

```sh
python3 deploy/preflight.py --config deploy/staging.example.json --root .
```

The example configuration is expected to fail because its evidence flags are false. To check a live-app directory, pass `--live /path/to/apps`; directory names are supplied in the config. To verify an upstream Logto source checkout, pass `--upstream-root /path/to/logto-master`. These are read-only checks.
