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
- Results are advisory authorization decisions. The destination app must independently enforce tenant access; Field's PostgreSQL RLS remains authoritative.
- Production services must use a persistence adapter that fails closed and checks revocation on every authorization or within explicitly bounded caches.

## Logto membership checks (`LogtoManagementVerifier`)

- A cold membership check makes **one** Management API call: `GET /api/users/{userId}/organizations`, then looks for the requested organisation ID in the response. Upstream Logto (v1.45.0, `packages/core/src/routes/admin-user/organization.ts`, `router.get('/users/:userId/organizations')`) does not paginate this endpoint, so the response is capped at 1,000 organisations and fails closed above that. A missing user returns 404 and is rejected. The earlier approach paged `/api/organizations/{id}/users` (up to 25 pages of 100), which was O(members) per check.
- Positive results are cached per `(organisation, user)` for `membershipCacheTtlMs` (default 30 seconds, maximum 5 minutes, 0 disables). The cache holds at most `membershipCacheMaxEntries` entries (default 1,000, oldest evicted first). Denials are never cached.
- **Trade-off:** a removed member can still pass a membership check for up to one TTL after removal in Logto. Lower the TTL, or set it to 0, where that window is unacceptable. The cache still saves a call on privileged decisions, since the role check makes a second request (`/roles`) after membership.

## Activity history (`activity_events`, issue #36)

Lifecycle events from Central and connected products share one schema, written by `recordActivity` (in the lifecycle transaction) or `recordActivityInOwnTransaction`, and read by `queryActivity`.

- **Fields:** `eventId`, `occurredAt`, `organisationId` (tenant key, required), `actorKind` (`subject` or `service`), `actorId`, `action` (dotted, e.g. `membership.update`), `targetType`, `targetId`, `sourceProduct` (`sorted`, `supercharged`, `lms`, `central`), `outcome` (`success`, `failure`, `denied`), `correlationId` (one value across products for one lifecycle chain; provisioning uses the request ID), `detail` (flat scalar object, at most 12 keys and 1,024 bytes), `recordedBy` (database role that wrote the row).
- **Redaction, before insert, fails closed** (`src/activity-redaction.ts`): a credential-named key or a credential-shaped or email-shaped value refuses the event. Personal-data keys (email, phone, address, date of birth, name, IP address) are removed and their names returned. Nothing is written for a refused event.
- **Append-only** (migration 0011): no role has UPDATE, DELETE or TRUNCATE. A trigger rejects those for every role, including the owner. The application must not connect as a superuser, since a superuser can disable triggers.
- **Reads:** `queryActivity` runs as `titan_trusted_reader`, scoped to one organisation by RLS and by an explicit filter. It returns newest first, in pages of at most 100, with a keyset `before` cursor. Callers must check that the requester may read the organisation before calling it. The function does not know roles.
- **Lifecycle wiring:** every `CentralProvisioner` write except identity creation records one event in the same transaction (`activityFor` in `provisioning.ts`). An identity belongs to no organisation, and the table is tenant-keyed, so identity creation is audited only in `provisioning_audit`. A refused event rolls back the lifecycle change.

**Not implemented:** retention deletion (blocked by the trigger, so a purge needs a separate owner-run procedure that is not written), an export job, tenant-facing and operator-facing read endpoints with role checks, and events from products other than Central. See `docs/RETENTION.md` section 6.

## Scope of this build

Implemented: typed contracts, three app registrations, role/action policy, entitlements, time-limited membership checks, local-account link checks, test suite, and draft SQL.

Not implemented: actual Logto server configuration, OIDC middleware, live app adapters, persistent SQL repository, payment/subscription provider, migration runner, revocation events, server deployment.

Do not apply the SQL draft to Logto's own schema; it is for review against a dedicated `titan_central` PostgreSQL database.
