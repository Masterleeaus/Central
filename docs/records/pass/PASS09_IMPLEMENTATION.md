# Titan Central — Pass 09: protected operator API and registration audit

## Functional changes

1. Added an opt-in operator-facing HTTP API in `apps/control-api/src/admin.mjs`. Only an injected, independently verified `authoriseOperator` callback may grant access. Both routes require a previously cryptographically verified OIDC bearer token. The standard Central server does **not** install the operator handler; absent explicit wiring, both endpoints return 404.
2. `GET /v1/admin/oidc/plans` returns the fixed, validated Desk/Field/Academy OIDC registration plans. The result excludes client secrets and prohibits query overrides. It does **not** register applications.
3. `POST /v1/admin/provision` accepts only strongly constrained membership, entitlement and local-account-link provisioning commands; rejects caller-supplied actor identity and disallows global identity/organisation creation. It requires an injected `provision` implementation (the TrustedProvisioningService must perform its own Logto membership, role, link proof and audit checks). Provisioning is unavailable without that injection. The authenticated actor is obtained only from a verified bearer token. All failures fail closed without leaking database errors.
4. Added the `LogtoApplicationInspector` to compare *operator-assigned*, trusted client IDs with applications returned by Logto's verified `GET /api/applications` Management API. It checks exact callback/logout URI sets and application type, caps pagination and rejects missing/duplicate/mismatched clients. It does not create applications, expose app secrets or accept management origin/credentials from a browser.
5. Added automated tests for the operator API, registration verification, invalid identity/role/tenant input, OIDC mismatch, API failures, and access disabled by default.

## Important integration requirements

The 2026-11-02 local source is NOT live-integrated. Real Logto Management API credentials and current tenant admin role checks must be wired in a trusted backend. Do not enable `createAdminHandler` with a static `authoriseOperator` returning `true`. The provided default `server.mjs` intentionally does not wire the administrator API. Production needs a separately reviewed platform-admin issuer/authority policy; organization administrators must not gain global management powers. An end-user OIDC access token is NOT a Logto Management API client credential.

Logto's source has `GET /api/applications` and `POST /api/applications`; this pass intentionally implements inspection only, not uncontrolled mutation. Plan callback URIs require real callback handlers in all three apps before creating clients or enabling SSO.

## Local checks and remaining gates

- Control-plane TypeScript compile and test suite.
- Control API suite.
- Upstream Logto source verification suite and cumulative archive integrity/hash check.
- No live Logto, PostgreSQL, Desk, Field or Academy connection executed.
- No migrations applied or services restarted.

**Next:** Pass 10 operator bootstrap and staging Logto integration; implement actual registered-client and OIDC code callback/session journeys in each app, with true current role checks, CSRF/state, nonce, PKCE, logout and revocation tests. Preserve upstream Logto source.
