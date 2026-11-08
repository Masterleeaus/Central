# Titan Central — Pass 14: Session revocation and tenant security

**Scope:** In-process, application-session authorization guard; account switching protocol; PostgreSQL revocation version storage. Upstream Logto source is unchanged.

## New code
- `apps/control-api/src/session-security.mjs`: fail-closed session validation, current org entitlement/account mapping, local account state, generation comparison, safe account switching.
- `apps/control-api/src/session-revocation-pg.mjs`: parameterized read/increment of a per-(app, Logto subject, org) generation.
- `migrations/0004_session_revocations_draft.sql`: dedicated Titan Central DB schema **not applied**.
- `apps/control-api/test/session-security.test.mjs`: 17 new tests covering org isolation, expiry, revocation, demotion, failure, account switching and SQL adapter.

## Integration requirements
1. Deploy Logto and Titan Central against supported, separately managed PostgreSQL databases, run reviewed Titan Central migrations in sequence. PostgreSQL 13 on the current live server is EOL; do not upgrade running databases without backups and an approved plan.
2. Mount the OIDC browser start/callback routes into each app, preserving current logins as rollback; implement production `loadSession`, `checkAccess`, `checkLocalAccount` and `rotateAppSession` using app stores and Logto-verified membership.
3. At session creation, persist `generation` from the **same account/subject/organisation scope** as the Central revocation store, plus expiry and account/role IDs from trusted server code. For each protected request, call the guard; never accept tenant context from query parameters as identity proof.
4. On verified membership removal, application entitlement revocation, and account-link revocation, call `revokeAll` through trusted provisioning server code. Integration is **not automatic** yet; wire it to each mutation path and test multi-instance propagation. Audit the action.
5. Session switch revokes the previous local session and issues a new session after target org validation; concurrent switch/login race protection and independent application session-store support still require live tests.
6. Provide app-specific logout (already built in Pass 13). Logto RP-initiated logout and back-channel logout have **not** been implemented; do not claim global logout until all three apps honor it.
7. Before go-live: staged two-tenant tests, role demotion, remote outage, cookie security, revocation across instances, accessibility and app SSO smoke tests.

## Verified local checks
- Node app/control-api: 108 passed, 0 failed.
- Node control-plane: 93 passed, 0 failed.
- Python upstream source verifier: 4 passed, 0 failed.
- This pass did not exercise a live PostgreSQL database or run live Logto, Desk, Field or Academy.

## Production verdict
**Source candidate only.** Requires app-specific adapters, live integration and deployment gate. This package is not a drop-in replacement for either running application.
