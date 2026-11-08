# Titan Central Pass 02 — Functional control-plane foundation

## What has been implemented
- Reusable dependency-free TypeScript control-plane package (`titan-central/packages/control-plane`).
- Canonical identity, organisation, membership, app entitlement, application-local account link, and verified-principal TypeScript contracts.
- Tenant-scoped, fail-closed `CentralAccessService` checking authenticated subject, expected OIDC issuer/audience, account membership, subscription features, roles and uniquely verified local account mapping.
- Three independently configured OIDC application registrations and HTTPS callback URL helper.
- Verified account link creation helper with five-minute bounded freshness (issuer authentication is the caller's obligation).
- Separate draft PostgreSQL schema with five constrained tables and indexes. **NOT APPLIED**.

## Important unfinished pieces
- OIDC token signature validation is deliberately **NOT** implemented. The access service accepts only server-verified principal objects. Never use raw request-body data as a principal.
- No persistent PostgreSQL repository driver, Logto webhooks, lifecycle events or actual OIDC application registration has been built.
- No Desk, Field or Academy adapter is installed or tested. No service has been deployed.
- The TypeScript authorization logic is a reusable library, not an API server. Do not grant AI agents direct SQL access.
- The schema is a draft for independent `titan_central` database; migration not reviewed against live Logto database ownership.
- Subscription billing and payments are out of scope of Pass 02.

## Checks
`tsc -p tsconfig.json`: successful using Node 22.16, system TypeScript compiler.
`node --test test/*.test.mjs`: 23 passed, 0 failed.
Pass 01 upstream sources preserved byte-for-byte in the cumulative ZIP.

## Pass 03 priorities
Implement transaction-safe PostgreSQL repository and migration runner in isolated `titan_central` DB; test constraint failures and revocation. Build OIDC middleware adapter with actual JWT signature validation against trusted JWKs, proper issuer/audience/expiry, and separate applications; add event delivery protocol for revocation. Do not modify Logto core.
