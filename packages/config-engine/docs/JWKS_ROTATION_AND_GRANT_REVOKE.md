# Pass 26 — signing key rotation and live service-grant revocation

The trusted issuer JWKS provider refreshes when an unknown signing key ID
arrives even if the cached keyset is not expired. Concurrent fetches share one
in-flight request, repeated unknown IDs are limited to one refresh per
three seconds, and stale keys are not used after cache expiry. Duplicate kid
values are rejected. JWKS stays HTTPS and same-origin as the configured issuer.

The pinned canonical CI integration also holds a single RSA-signed JWT
constant while revoking the associated service-company grant in real
PostgreSQL. The live Central HTTP route must deny the same unexpired token
immediately after grant revocation, and reauthorise only after grant
restoration. This tests **service-wide grant revocation**, not issuer-side
individual JWT-jti revocation. Real Logto JWKS rotation/revocation is still
a live environment acceptance requirement.
