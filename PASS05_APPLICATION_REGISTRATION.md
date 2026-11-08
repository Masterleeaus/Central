# OIDC Registration Checklist — NOT LIVE CONFIGURATION

These are separate OIDC applications registered **in Logto after deployment**. Use OIDC Authorization Code + PKCE, exact HTTPS callbacks, validated `state`/`nonce` and audience-scoped access tokens. Each application must validate the issuer, expiry, audience and the authenticated subject. Titan Central's existing API receives an ACCESS token minted for its resource, not an ID token intended for a frontend.

| Application | Proposed Origin | Callback Contract | Env reference |
|---|---|---|---|
| Field | https://field.titanzero.io | /auth/callback | TITAN_FIELD_OIDC_CLIENT_ID |
| Desk | https://desk.titanzero.io | /auth/callback | TITAN_DESK_OIDC_CLIENT_ID |
| Academy | https://academy.titanzero.io | /auth/callback | TITAN_ACADEMY_OIDC_CLIENT_ID |

**Do not register these callback URLs until the receiving apps implement the callback routes.** No session-cookie sharing between apps. Authenticate each app separately against the same trusted provider, and validate local business entitlements on every sensitive request. The app registrations currently consist of type-safe contracts, not automatic provisioning.

## Tenant ownership and mapping

Logto `sub` identifies the central individual; Logto organisation identity identifies membership. Mapping to `titan.identities`, `titan.organisations`, and `titan.local_account_links` requires independently verified matches. Never match by email/company name or accept client-supplied account IDs as proof. Pass 05 database provisioning requires a trusted administrative wrapper; no UI/API mutation exposure is shipped.
