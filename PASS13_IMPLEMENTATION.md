# Titan Central Pass 13 — App session handoff and logout contracts

## Delivered
- `apps/control-api/src/oidc-app-session.mjs`: verified-identity resolver and application-session adapter; strictly server-selected organisation IDs, exactly one authorised organisation and fresh local account checks. Authentication fails closed for multi-organisation ambiguity (user-driven organisation selection remains future work).
- New app-scoped session issuer: delegates **atomic revocation/rotation** to the existing Desk, Field or Academy session store. Binding includes `localUserId`, `localAccountId`, `organisationId`, verified Logto issuer/subject. No cross-subdomain cookies.
- App-local POST logout endpoint: exact origin + fetch-site check, authenticated app-session lookup, confirmed revocation, then host-only secure cookie clearing. The handler does **not** claim to perform Logto-wide logout.
- Existing Pass 12 OIDC callback now requires and forwards verified organisation/account IDs into the application session creation hook. Registry defines `session:open` roles as an application action, but grants MUST include that entitlement feature on initial provisioning for SSO to work.
- Automated tests of selection, proof, revocation errors, CSRF origin, denied accounts, and required session context.

## Deployment integration still required (NOT complete)
1. No live application session store is connected. Inject the actual app's `rotateAppSession`, `authenticateSession`, `revokeSession` and `localAccountActive` after inspecting its session implementation. Keep preexisting login until a staged rollback-backed switchover.
2. The trusted Central `findOrganisationIds` query, `authorise` snapshot implementation and revocation propagation must be wired to a live Central database. Do not use email/hostname/desk company text as a tenant binding.
3. Multi-org users cannot sign in through this automatic mapping, by design: choose an organisation with a separate CSRF-protected flow, then verify membership and entitlement again before rotation.
4. App-local logout does not terminate the Logto provider session; integrate OIDC RP-initiated logout and backchannel/frontchannel events only after checking Logto protocol support and the actual apps' logout contracts.
5. Secure cookie and local sessions require real HTTPS and same-origin CSRF controls for all state-changing endpoints. Trusted app-specific auth adapters not included.
6. No database migrations applied, no live Logto instance or PostgreSQL integration tested; app route mounts and deployment remain pending.
