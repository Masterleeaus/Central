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
session issuer. Session credentials are not returned by the coordinator. The
module is not mounted in the HTTP server because durable
selection storage, Central-owned OIDC callback/session issuance, and a trusted
organisation discovery query are not yet wired. The browser must never receive
the issuer/subject or gain authority from a posted company ID.

Tests: `node --test test/organisation-selection.test.mjs`.

## Central-owned opaque browser sessions (third slice)

`src/central-session.mjs` now provides a separate Central session manager:
256-bit random opaque tokens; SHA-256 token digests only in a mandatory
injected durable store; host-only `__Host-titan-central` cookie with
`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and eight-hour maximum
age; strict duplicate-cookie rejection; expiry checks; revocation and
token rotation on company switching. Rotation never reuses the previous
token and rejects identity changes.

**Not wired to the web server yet:** The `store` interface requires an
atomic, durable PostgreSQL implementation and an approved migration.
Session issuance must occur only *after* a verified Logto OIDC exchange
and authorised company selection, with independent re-verification of
company access. Company switching must recheck live membership before
rotation. `readProducts` must still be called on each launcher request.
A cryptographically secure token does not itself grant access to a company.

Before deployment, add database-backed session storage and concurrency
tests for revocation/rotation, including cross-worker behaviour and
operator-driven global revocation. Do not rely on an in-memory store.
Tests: `node --test test/central-session.test.mjs`.

## Explicit launcher composition

`src/central-launcher-service.mjs` composes the session manager,
transaction-scoped product reader and HTML launcher. It is intentionally not
mounted by `server.mjs` and cannot make an unverified OIDC claim trusted.
The composition integration test exercises issuance, access, product display,
session revocation, and denial after revocation.

Required before production: persistent PostgreSQL session store/migration,
trusted Logto OIDC callback, company-selection and membership revalidation,
strict cookie policy verification behind the reverse proxy, staging flows,
and product destination verification. Integration: `node --test
test/central-launcher-service.test.mjs`.

## PostgreSQL-backed session store (fourth slice)

The ordered migration `migrations/0009_central_browser_sessions.sql` adds
`titan.central_browser_sessions`, an expiry index, FORCE RLS and the isolated
NOLOGIN `titan_central_sessions` role. That role alone receives SELECT,
INSERT and DELETE grants on the session table; ordinary tenants and trusted
readers cannot read it.

`src/central-session-pg.mjs` supplies the required durable store with
transaction-local `SET LOCAL ROLE titan_central_sessions`. Operations
bind all values as SQL parameters. `delete(digest)` returns a boolean
obtained from `DELETE ... RETURNING`, allowing session rotation to reject
concurrent consumption of the previous token. Expired sessions can be
pruned in bounded SKIP LOCKED batches.

Deployment MUST provision a non-superuser, NOINHERIT service credential and
explicitly grant `titan_central_sessions` to that login account:
```sql
GRANT titan_central_sessions TO titan_central_app;
```
Never grant that role to tenant-access credentials, and never expose raw
token digests or session data through a public endpoint. The schema is not
applied to production. It is not reconciled with draft shared-company migration
PR #46, and its `organisation_id` FK must be migrated to canonical
`company_id` after the shared database contract is finalized.

New verification: `node --test test/central-session-pg.test.mjs` and
`psql -X -v ON_ERROR_STOP=1 -f tests/sql/central_browser_sessions.sql
"$TITAN_CI_DATABASE_URL"` on disposable PostgreSQL after migration 0009.

## Central OIDC browser callback and isolated login state (fifth slice)

`src/central-oidc-browser.mjs` implements exact, rate-limited
`GET /auth/central/start` and `GET /auth/central/callback` handlers,
still deliberately unmounted. The callback accepts only one-time OIDC
state, code and host-only browser binding, and calls an injected
`oidcLogin.complete` that must verify issuer, audience, nonce and PKCE
code exchange. Only an independently verified Logto subject can reach
membership lookup. A single eligible company must be returned; multiple
eligible companies fail closed until #32 implements bound explicit selection.
The handler rechecks live company membership before issuing a Central
session. Query-string company selection is rejected.

Migration `0010_central_oidc_login_namespace.sql` adds the `central`
application namespace to the existing OIDC state schema. A dedicated
NOLOGIN `titan_central_oidc` role and FORCE RLS isolate Central's
state from product writers; `src/central-oidc-state-pg.mjs` reuses
the AES-256-GCM sealed, atomically consumed state store inside
transaction-local role changes. The production login credential requires:

```sql
GRANT titan_central_oidc TO titan_central_app;
```

The browser flow is **not production-ready**: an operator must register
the exact Central callback URI with Logto; configure the verified
OIDC client, secret and issuer discovery (see #30); provide live,
authoritative company eligibility and recheck implementations; and
mount the authenticated router only after company selection and
cross-product revocation behavior are verified. In particular,
`createCentralOidcBrowserHandler` accepts externally injected
`listEligibleCompanies` and `recheckCompany` but does not implement
those callbacks; client-supplied selections must never be accepted.

Test: `node --test test/central-oidc-browser.test.mjs
test/central-oidc-state-pg.test.mjs` plus
`tests/sql/central_oidc_state_isolation.sql` in disposable PostgreSQL.

## Sign-in composition (sixth slice)

`src/central-sign-in-service.mjs` composes the existing
Authorization Code + PKCE login engine, isolated encrypted Central
OIDC state, the browser callback, and the Central session manager.
The configured redirect URI must be exactly
`/auth/central/callback` with no query, fragment or untrusted HTTP
origin. The callback is registered independently for Central and must
not borrow a product's client ID or redirect URI.

Integration tests exercise start, callback, PKCE challenge,
one-use state consumption, replay denial, membership recheck,
and exact callback registration. Verification is mocked in tests;
live Logto and real token-signature validation have not been tested.

Remaining gating steps are issuer discovery (#30), a production
ID-token verifier and registration, trusted company eligibility/recheck
implementations, the multi-company choice ceremony (#32), and
server route mounting after those pieces have been integrated.
