# Titan Central Pass 11 — durable login state + ID token verification

## Implemented
- `apps/control-api/src/oidc-state-pg.mjs`: PostgreSQL-backed login-state store, keyed by application and SHA-256 opaque state digest. A single `DELETE ... RETURNING` consumes a state atomically. No state is exposed as a query parameter to SQL; all SQL inputs are parameterized.
- `apps/control-api/src/oidc-id-token.mjs`: separate RS256 OpenID Connect ID-token validator, bound to configured issuer, audience and JWKS endpoint, with signature, expiry, issued-at, nonce presence, azp for multi-audience, and restricted key-header validation.
- `migrations/0003_oidc_login_state_draft.sql`: independent Central database-only state table, unapplied.
- 13 new Node tests for valid and hostile cases.

## Integration boundary and remaining work
- The existing Pass 10 `createOidcLogin` supports dependency injection of `loginStore` and `verifyIdToken`; plug these two modules into each application's login callback only once live auth routes, session cookie handling, and trusted application identity are reconciled.
- Do **not** expose either store or validator through unauthenticated HTTP admin endpoints. Login state must be bound to a server-generated, HttpOnly, SameSite cookie.
- An application's own server should create its own session after the callback, not trust a browser-supplied subject. Need secure session rotation, CSRF protection, logout handling, verified local account linking and organisation membership authorization.
- **No live OIDC application registrations, production session adapters, PostgreSQL migration, or SSO login have been completed**. PostgreSQL tests use simulated connections. Production requires real multi-instance replay testing.
- Use a dedicated supported Central PostgreSQL database, **not** the existing `titan_desk`, `ai_fsm`, or Logto database.
- Support for ES256, discovery metadata and OIDC at_hash/c_hash/clock-skew policy is not included; choose approved Logto signing algorithm/configuration after deployment. This verifier intentionally accepts only RS256.
- If a database operation fails while consuming state, the callback must abort, never fall back to in-memory state.

## Tests
`node --test titan-central/apps/control-api/test/*.test.mjs titan-central/packages/control-plane/test/*.test.mjs`
`python -m unittest discover -s titan-central/tests -p 'test_*.py'`

## Release status
Locally tested cumulative **source** candidate. Original Logto files are not modified. Not deployment-ready, no live SSO, no server changes.
