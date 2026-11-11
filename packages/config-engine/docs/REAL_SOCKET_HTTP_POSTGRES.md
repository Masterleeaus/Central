# Real Central HTTP socket, JWT, database and lifecycle test

On the pinned PR #46 canonical PostgreSQL 16 CI schema, the new integration
script starts the actual Central HTTP service on 127.0.0.1 and verifies the
config-read endpoint over real TCP HTTP requests, with generated RSA-signed
machine JWTs, independent authenticated restricted PostgreSQL config/grant
pools, matching canonical migration SHA-256 receipt and row-level security.

Tests cover distinct company-scoped values, revoked/expired/unknown service
grants, incorrect issuer/audience, conflicting client identities, forged
company headers or query parameters, duplicate keys, unauthenticated access,
HTTP method rejection, health response and cached JWKS. A disabled config
plane remains 404. Closing the service twice must close all three pools once.

The failure path uses the actual CI database to reject a wrong migration
checksum and authenticated database role, and checks all pools close after a
real occupied-port listen error. The operational Central main pool alone is
faked because this test targets the configuration subsystem; configured
TLS URI constraints are intercepted by the explicit CI-only adapter and
local disposable PostgreSQL does NOT exercise encrypted network transport.
Do not use this adapter, fixture keys or credentials in production.
