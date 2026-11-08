# Titan Central control-plane library (Pass 02)

This **is not an identity provider** or an HTTP server. It is a dependency-free TypeScript authorization layer intended to be called *after* OIDC login verification. Logto owns authentication, canonical Logto user identifiers and its own organization metadata. This package resolves app-scoped roles, features and individually verified local user/account links.

## Build and test

With Node.js 22+ and TypeScript available:

```bash
tsc -p tsconfig.json
node --test test/*.test.mjs
```

The `dist/` directory contains compiled source for local testing. A future build should use pinned workspace dependencies and a lockfile.

## Trust boundaries

- A `VerifiedPrincipal` **must only** be provided by an OIDC middleware that checks cryptographic signature, issuer, audience, expiry, nonce/state and PKCE where applicable. This library does not perform those checks.
- A local account link must only be created after the destination app confirms the authenticated member and their current organisation. The `linkFromVerifiedAssertion()` helper checks structure and freshness but **not** proof signatures.
- `AccessRequest.organisationId` is a requested context, never a grant. Access is denied unless the authenticated subject has current active membership, a specific app entitlement and a verified local-account link.
- Results are advisory authorization decisions. The destination app must independently enforce tenant access; Sorted's PostgreSQL RLS remains authoritative.
- Production services must use a persistence adapter that fails closed and checks revocation on every authorization or within explicitly bounded caches.

## Scope of this build

Implemented: typed contracts, three app registrations, role/action policy, entitlements, time-limited membership checks, local-account link checks, test suite, and draft SQL.

Not implemented: actual Logto server configuration, OIDC middleware, live app adapters, persistent SQL repository, payment/subscription provider, migration runner, revocation events, server deployment.

Do not apply the SQL draft to Logto's own schema; it is for review against a dedicated `titan_central` PostgreSQL database.
