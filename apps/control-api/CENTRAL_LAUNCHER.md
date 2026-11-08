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

The ordered migration `migrations/0010_central_browser_sessions.sql` adds
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
"$TITAN_CI_DATABASE_URL"` on disposable PostgreSQL after migration 0011.

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

Migration `0011_central_oidc_login_namespace.sql` adds the `central`
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

## Authoritative company discovery and recheck (seventh slice)

Migration `0012_central_company_discovery.sql` adds the
`titan.central_eligible_companies(subject)` function, restricted to a
dedicated NOLOGIN `titan_central_discovery` role. Its audited query returns
only active company memberships with a current product entitlement.
It does not expose direct membership-table SELECT privileges to the
browser-login credential. The function is SECURITY DEFINER, has a fixed
search path and revokes PUBLIC execution. As it accepts an authenticated
subject as an argument, it MUST be called only after signature/issuer/nonce
verification and must not be exposed as a public arbitrary-subject API.

`src/central-company-authority.mjs` provides a trusted
`listEligibleCompanies`, `listOrganisations` (trusted names for #32)
and `recheckCompany`. Discovery uses a restricted read-only
transaction, validates the record count and IDs and fails closed on
duplicate/malformed results. Recheck uses the normal tenant-scoped RLS
snapshot and verifies active identity, organisation, unique current
membership, and at least one live product entitlement immediately before
issuing a session.

`createCentralSignInService` now automatically creates the authority
when callbacks are not explicitly injected; callers must supply
`getCompanyName` as a trusted provider. A deployment role must have
`GRANT titan_central_discovery TO titan_central_app` in addition to the
previous Central role grants. This is not a production migration yet.
CI now checks `tests/sql/central_company_discovery.sql` for role
restrictions and revoked-company exclusion.

**Still outstanding:** complete durable multi-company selection and its
HTTP form/POST handler, bind the one-use choice state to the same browser
that completed OIDC, verify logout/revocations, reconcile the #43 canonical
company table, and mount the system after live Logto staging verification.

## Multi-company selection handoff (eighth slice)

Migration `0013_central_company_selection.sql` creates a dedicated, short-lived
`titan.central_company_selection_states` table. The NOLOGIN
`titan_central_selection` role alone can read, insert and delete state;
FORCE RLS blocks ordinary tenant and trusted-reader roles. Only digests
of random selection tokens and browser bindings are readable in the
table; the verified issuer, subject and permissible company IDs are
AES-256-GCM sealed with state- and field-specific AAD.

`src/central-selection-pg.mjs` implements atomic one-use
`DELETE ... RETURNING`, bounded expiry and pruning. Existing
`organisation-selection.mjs` coordinates the current membership recheck.
`src/central-selection-http.mjs` renders an escaped, no-store HTML
selection form to users with multiple eligible companies and handles
an origin-checked `POST /auth/central/select` with bounded, strict
form parsing. The OIDC binding cookie must be present on POST; the
one-use selection token and allowed company set are server-stored.
The selected company is rechecked against live tenant-scoped authority
before issuance of the Central session. Replay, foreign companies,
changed browser bindings and revoked memberships fail closed.

The sign-in service enables this via `enableCompanySelection: true`,
which requires a trusted `listOrganisations` resolver and either a
dedicated `selectionStore` or the default PostgreSQL store. For
production, grant the dedicated role to the approved login credential:
```sql
GRANT titan_central_selection TO titan_central_app;
```
It is **not automatically mounted or enabled** in the live API server.
Configure and stage the protected OIDC path and session services before
activation. Deployment also requires canonical company reconciliation
with #43 / PR #46, live Logto verification, cookie/reverse-proxy checks,
and logout/global revocation testing.

## Logout and automatic Central-session invalidation (ninth slice)

`src/central-logout.mjs` handles only same-origin POST
`/auth/central/logout`, rejects query strings and request bodies,
and revokes the opaque browser session from durable storage **before**
sending the host-only cookie deletion and a fixed redirect. A failed
database revocation returns 503, never a false success. The logout
form appears in the product launcher only when the service is explicitly
configured with a trusted HTTPS `origin`; the page CSP then permits
only same-origin form submission.

Migration `0014_central_session_access_revocation.sql` installs
transactional access-change triggers on memberships, company state,
identity state, entitlements and local-account link revocation. Their
SECURITY DEFINER functions delete affected Central browser sessions
in the same transaction as access changes, and roll back together if
that transaction is aborted. This is Central-browser revocation only;
it does **not** revoke separate Logto or product-owned sessions.

Migration `0015_authorised_central_session_issue.sql` closes the
race between the last membership recheck and session insertion.
`titan_central_sessions` loses direct INSERT privileges. The
restricted `central_issue_browser_session` function checks and locks
the active identity, membership, company and at least one active
entitlement in the inserting transaction. Updates then either commit
first (the new session is denied) or wait for issuance to commit before
their triggers delete it. Session creation through the PostgreSQL store
now uses this function rather than an unguarded INSERT.

Disposable PostgreSQL checks:
`tests/sql/central_session_access_revocation.sql` and
`tests/sql/central_authorised_issue.sql`. Node tests cover logout
origin enforcement, duplicate/forged requests, unavailable storage,
launcher composition and scoped session issuance.

**Operational boundaries:** There is still no live Logto RP-initiated
logout or distributed product logout. Session revocation from external
identity-provider changes requires an authenticated inbound sync or
reconciliation process. The trusted HTTPS origin, correct reverse
proxy headers, authorised DB login role memberships, and live Logto
staging must be verified before enabling these handlers in
`server.mjs`. Canonical company migration #43 / PR #46 remains
an independent blocker.

## Migration collision reconciliation (tenth slice)

The latest default branch introduced `0009_login_role_session_and_oidc_grants.sql` while this draft PR independently used version 0009. Before merging, the PR's session, OIDC, discovery, selection, revocation and locked-issuance migrations were renumbered in order to **0010–0015**; the exact 0009 source from `main` was added unchanged. `tests/test_migrate.py` now requires versions 1–15. Do not apply the earlier branch's original 0009–0014 manifests; those numbers are superseded. Re-run the full migration chain and schema checks before deployment.

## Guarded browser routes in the actual API server (eleventh slice)

`src/central-browser-router.mjs` now composes existing launcher,
secure logout, verified OIDC ID-token verifier, sign-in callback,
authoritative company access, and one-use multi-company selection.
`server.mjs` delegates to this browser router **only** when
`TITAN_CENTRAL_BROWSER_ENABLED=1`. The default (unset or `0`)
does not mount any browser routes and preserves existing API behavior.
Unknown paths fall through to the existing Central API handler.

Required enabled-mode settings (no hidden fallback values):
- `TITAN_CENTRAL_BROWSER_ENABLED=1`
- `TITAN_CENTRAL_BROWSER_ORIGIN=https://central.example/`
- `TITAN_CENTRAL_BROWSER_REDIRECT_URI=https://central.example/auth/central/callback`
- `TITAN_CENTRAL_BROWSER_CLIENT_ID` and `TITAN_CENTRAL_BROWSER_CLIENT_SECRET`
- `TITAN_OIDC_ISSUER` and `TITAN_OIDC_JWKS_URI` (already required by the Central API)
- `TITAN_OIDC_STATE_KEY` (base64-encoded AES-256 key)
- `TITAN_CENTRAL_SORTED_ORIGIN`, `TITAN_CENTRAL_SUPERCHARGED_ORIGIN`,
  and `TITAN_CENTRAL_LMS_ORIGIN` (distinct HTTPS origins)

The callback URL is validated for **exact** equality with the selected
Central HTTPS origin and path; HTTP, fragments, alternative origins
and changed paths fail at startup. A separate registered OIDC browser
client is required. The production server must be explicitly supplied
with a trusted `getCompanyName` callback; it does **not** accept a
company-name header or synthesize a name. Enabled startup rejects
missing trusted dependencies and closes the database pool before
failing. The browser router reuses `createIdTokenVerifier` for
cryptographic RS256 issuer/audience/nonce/expiry verification and
never uses the resource-server's app access tokens as browser identity.

Test coverage includes disabled/enabled feature gating, unsafe
callback configuration, component-level sign-in → launcher → logout,
and a real loopback HTTP server delegation test.

**Not ready to enable on production:** the trusted company name
resolver is an explicit injected dependency and has not been
provided through the production CLI entrypoint; live Logto browser
registration, production DB role memberships, canonical company
schema (#43 / PR #46), and end-to-end product sign-in testing remain.
The flag must remain off until these steps are completed and verified.
