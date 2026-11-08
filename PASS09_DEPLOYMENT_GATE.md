# Pass 09 — Deployment safety gate

The ZIP is cumulative **source**, not a deployable service image. Do not unzip it over installed Logto, Desk, Field or Academy. It includes the whole upstream Logto source and a separate `titan-central/` extension.

1. Confirm PostgreSQL >= supported Logto version and isolated Logto/Titan Central databases. Do not migrate the shared PostgreSQL 13 server in place without backups.
2. Install Logto staging at a distinct origin and port, verify its discovery document, JWKS and Management API scope.
3. Create three confidential application registrations via approved Logto administrative operation only **after** verifying real callback implementations exist. Never put client secrets in this ZIP or browser.
4. Supply trusted application client IDs to `LogtoApplicationInspector` and require all three statuses to be `registered` before enabling SSO.
5. Bind the operator handler only after a real OIDC verifier plus a live `authoriseOperator` that independently rechecks current platform operator authority. Wire the actual trusted provisioning service and auditable database transactions before enabling writes. Keep it disabled for staging until verified.
6. Verify SSO state and PKCE S256, nonce where applicable, account switching, cross-tenant isolation, role revocation and unified logout. Preserve Field and Desk operational databases.
7. Obtain explicit approval before any live restart, migrations, role grants or reverse proxy changes.

## Rollback

Disable administrator handler injection (returns 404), remove feature flags, and restore the prior service revision. No schema or live application changes are performed by this source release.
