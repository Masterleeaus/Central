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
