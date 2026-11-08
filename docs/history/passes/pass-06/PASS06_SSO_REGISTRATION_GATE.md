# SSO application registration gate — all three apps

No OIDC clients were created or modified in a running Logto service in Pass 06.

- Field: `https://field.titanzero.io` — intended OIDC redirect `https://field.titanzero.io/auth/callback` **only after** the callback is implemented.
- Desk: `https://desk.titanzero.io` — intended redirect `https://desk.titanzero.io/auth/callback` **only after** implementation.
- Academy: `https://academy.titanzero.io` — intended redirect `https://academy.titanzero.io/auth/callback` **only after** the LMS is installed and a handler exists.

Require Authorization Code + PKCE (S256), exact registered redirect URLs, issuer+audience validation, state and nonce checks, backend-maintained sessions, secure `HttpOnly` cookies, and full login/logout/revocation tests. Each app checks its own application entitlements and organisation access; central login alone never grants operational permissions. Session cookies and passwords are **never** synchronised between apps.

The identity issuer domain, client IDs, client credentials and TLS configuration **must be established on the actual server**. Do not rely on placeholder registrations in the source.
