# Integration boundary: configuration reads (Issue 38)

This module reuses Central's OIDC design: RS256 tokens are verified against
an explicitly configured JWKS URI. The URI must match the issuer's HTTPS origin.
Service tokens are only identity evidence; product/company entitlements come
from a separately trusted service grant registry.

`createConfigApi` composes a verified M2M gateway, grant resolver, HTTP
handler, and a PostgreSQL-backed read-only scoped store. Every scoped read
starts a REPEATABLE READ READ ONLY transaction, switches to the restricted
reader role, and sets transaction-local tenant/cohort context before SQL.

This composition is **opt-in** and unmounted. Production host wiring must
provide a trusted grant lookup, safe service rate limiting, revocation policy,
real company foreign keys and unified shared-database migration ownership.
No HTTP client may control the company or cohort directly, and a custom SQL
session setting is not authentication.
