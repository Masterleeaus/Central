# Titan Central launcher — Issue #44 (foundation)

The pure HTTP renderer in `src/central-launcher.mjs` is an initial **unmounted**
portion of the Central product experience. It is not an authenticated web
application on its own and must not be exposed as a public route before the
following dependencies are implemented and verified.

## Trust contract

- `resolveSession(req)` must validate a Central-owned, host-only, server-side
  session; never decode caller-provided identifiers or trust an unsigned cookie.
- `readProducts({identityId,companyId})` must verify current membership,
  company status, and every product's entitlement using trusted database reads.
  It must return `{authorised,company:{id,name},products:[{id,status}]}`
  with exactly one decision for each of `sorted`, `supercharged`, `lms`.
- Configure destinations through server-owned HTTPS origins, not user input.
- Rendered links are **navigation**, not authorization. Each product must still
  enforce its own server-side access and current entitlements.
- The launcher deliberately does not implement company switching. Implement
  issue #32's one-use, reverified organisation selection first. Never switch
  a company by changing a query string or reusing the old company session.
- Sign-in and logout must use a registered OIDC callback and issue/revoke an
  independent Central session. Do not treat product session cookies as Central
  sessions.

## Tests

`node --test test/central-launcher.test.mjs` from `apps/control-api`.

## Outstanding acceptance criteria

Sign-in and OIDC callback mounting; secure session creation/revocation;
tenant-safe entitlement reader; server wiring; company selection; responsive
browser accessibility/route E2E checks; integrated destinations; staging tests.
Do not mark #44 complete until these have passed.

## Trusted entitlement reader (next implementation slice)

`src/central-product-reader.mjs` exports `createCentralProductReader`.
It uses the existing `withCentralReadSnapshot` helper with transaction-local
RLS and the trusted reader role. It verifies active identity, company and exactly
one active non-expired membership, then checks each product's entitlement and
verified local account link. An entitled product without a verified local link
is labelled unavailable, not launchable.

The reader temporarily maps the current main-branch application identifiers
`field -> sorted`, `desk -> supercharged`, `academy -> lms`.
These must be reconciled with the new canonical registry in issue #43 / PR #46.
The caller must provide a verified Logto subject from a Central-owned secure
session, and a trusted `getCompanyName` provider. The currently committed
database schema does not provide a suitable company display name directly.

This is an isolated service module. **Do not mount it** before Central's
server-side session lifecycle and verified company-selection flow exist.
Tests: `node --test test/central-product-reader.test.mjs`.

## One-use organisation selection (partial issue #32 implementation)

`src/organisation-selection.mjs` provides the selection coordinator. It issues a
random one-use state bound to a hash of the browser binding and stores the
allowed organisation IDs server-side. On selection, the state store must consume
the token atomically; the coordinator verifies the selected ID was in the stored
choice set, rechecks current membership/access, and only then calls the Central
session issuer. The module is not mounted in the HTTP server because durable
selection storage, Central-owned OIDC callback/session issuance, and a trusted
organisation discovery query are not yet wired. The browser must never receive
the issuer/subject or gain authority from a posted company ID.

Tests: `node --test test/organisation-selection.test.mjs`.
