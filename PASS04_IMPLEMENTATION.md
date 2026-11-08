# Titan Central Pass 04 — Runnable Read-Only Control API

## Implemented
- New independent Node HTTP service under `titan-central/apps/control-api`.
- Strict RS256 JWT/JWKS validation with pinned issuer, audience, expiry, signature, and key discovery. External JWKS URL configured by operator, never accepted from token headers.
- Read-only `/v1/access/check?organisation_id=<uuid>&application=desk|field|academy&action=<action>` and `/healthz`.
- Principal derived exclusively from cryptographically verified bearer token; no caller-supplied user ID or SQL accepted.
- Uses Pass03 `withCentralReadSnapshot` and access-control engine; no Logto upstream code changed.
- Binds 127.0.0.1, default port 3102; requires runtime `pg` and separate Titan Central PostgreSQL role and database.

## Deployment prerequisites (NOT YET SATISFIED)
1. Real Logto deployment and issuer/JWKS endpoint; service requires a **Logto-issued access token** with configured Central audience, not an ID token used as an API token.
2. Database migration `0001_control_plane_draft.sql` reviewed and applied to separate `titan_central` DB.
3. Restricted read-only PostgreSQL account for API, explicit enrolment/admin provisioning flow.
4. NPM dependency installation and testing on actual Node/server; reverse proxy, TLS, request throttling, audit, role-specific client token authorization, production monitoring.
5. Real PostgreSQL + Logto integration tests; current tests use mocks.

## Security notes
- `/healthz` is lightweight liveness only; does not assert DB or OIDC availability.
- `/v1/access/check` is a **user-token authenticated endpoint**, not a service-to-service API. It returns a boolean and revisions; never local account IDs.
- Access checks use Logto subject + entitlement + membership + independently verified local link. Tokens only assert identity; they cannot override organisation membership.
- Do not expose API directly to the Internet before rate limiting and perimeter/route rules have been designed.
- No privileged mutations exposed. Pass03 mutation library is not wired to HTTP.
