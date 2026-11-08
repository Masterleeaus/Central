# Titan Central Pass 05 — Transactional Provisioning Foundation

## Added, not deployed

- `packages/control-plane/src/provisioning.ts`: `CentralProvisioner.apply()` stores a canonical identity, organisation, membership, entitlement, or explicitly verified local app-account link within a single PostgreSQL transaction. The caller must independently verify the Logto organisation/user and authority to provision; a `authorityReference` is an audit pointer, **not** verification by itself.
- `migrations/0002_provisioning_audit_draft.sql`: idempotency and immutable audit table schema; unapplied and for review only.
- `packages/control-plane/test/provisioning.test.mjs`: positive, duplicate replay, conflict, SQL error, rollback and validation tests.
- `PASS05_APPLICATION_REGISTRATION.md`: registration and callback plans for three OIDC clients without hard-coded secrets.

## Required before any use against live accounts

1. Deploy a supported Logto instance, pin issuer/JWKS and create **three independent confidential OIDC clients** with Authorization Code + PKCE, redirect URI allowlists and HTTPS. Registration values must come from the actual hostnames; callbacks in `applications.ts` are contracts and NOT deployed endpoints.
2. Deploy a separate PostgreSQL `titan_central` database; review and migrate 0001 then 0002, least-privilege DB roles, TLS and backups. Do not run migrations on `ai_fsm` or `titan_desk`.
3. Implement a **trusted management adapter** which verifies Logto Management API responses (or equivalent trusted administrative source), actor permissions, organisation membership, and proof of local account control. Only that adapter may invoke `CentralProvisioner`.
4. Enforce revocation, least-privilege service access, audit log retention, rate limits, and SSO integration in Desk, Field and Academy. The current central API is READ-ONLY; no public provisioning endpoints have been introduced.
5. Add real PostgreSQL integration tests, Logto-issued token tests and end-to-end app-login, logout, account switching and multi-tenant isolation tests.

## Preservation

No upstream Logto source files modified. No live server/db operations. No new admin API or trusted Logto management adapter is claimed. Archive integrity and local tests are checked during packaging.
