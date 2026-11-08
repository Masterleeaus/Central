# Titan Central Pass 12 — app-side OIDC browser adapter

## Implemented
- `apps/control-api/src/oidc-http-adapter.mjs`: a framework-neutral GET start/callback handler for Desk, Field and Academy using the Pass 10 OIDC flow, Pass 11 persistence and cryptographic verification.
- Secure, host-only HttpOnly SameSite=Lax browser-binding cookie; no untrusted return-URL parameter.
- Callback consumes OIDC login state, resolves a **verified local identity** from a trusted server-side adapter, requires current authorisation, and delegates session creation to the local application (with rotation required by integration contract).
- Fail-closed behaviour on missing binding, duplicate callback parameters, unlinked identities and session-adapter failures. Success clears the correlation cookie and redirects to a fixed local path.
- Focused tests for successful/failed flows, callback attacks and service errors.

## Mandatory integration gates
1. This is a reusable handler **not mounted into running Desk/Field/Academy routes**. Existing app sessions must be rotated by each app's actual auth middleware. `establishSession` must create a fresh random, stored, revocable session and invalidate the pre-login session; the cookie string check is only a basic syntactic guard.
2. `resolveLocalIdentity` must verify application-specific identity links and current organisation entitlements, not email/name or caller-provided account IDs.
3. Configure exact Logto-registered callback paths. Current package OIDC registration plans may have different paths: reconcile before deployment. No endpoints are yet active.
4. Implement session expiry, explicit logout, CSRF controls on post-login mutations, revocation event handling and account switching before production SSO.
5. Apply Central state migration only against a dedicated compatible Central database; run Logto against a supported PostgreSQL instance. Test multi-instance callbacks and real tokens.
6. No automatic user provisioning or account linking from an untrusted callback; no cross-application login/session cookies.

## Status
Locally testable source candidate; no live SSO or application builds, no live databases modified.
