# Registration checklist: not yet provisioned

1. Deploy Logto and its **separate supported** PostgreSQL database on staging; confirm real issuer, TLS and health.
2. Create distinct Logto traditional-web OIDC clients for `desk`, `field`, and `academy` through the documented management interface, with exact callback URIs only after routes exist.
3. Grant limited Management API scopes to the Titan Central M2M app; verify the Logto role-ID allowlist against real administrator roles.
4. Build and test server-side callback handlers in **each** app. Store secrets server-side; use HttpOnly, Secure, SameSite cookies.
5. Exercise user login, organization selection, role demotion, membership revocation, logout, token expiry and invalid nonce/state cases.
6. Apply the draft Titan Central migrations **only** on a dedicated, backed-up Titan Central database after migration review.
7. No destructive changes to `ai_fsm` or `titan_desk`; no direct cross-tenant SQL access.
