# TITAN CENTRAL — PASS 01: SOURCE & ARCHITECTURE AUDIT

**Source inspected:** user-supplied `logto-master.zip`; **Logto core version:** `1.45.0`. **Date:** 2026-11-02. **Scope:** source audit, architecture boundary and reproducible baselining; **no live installation, runtime build, migrations or app modifications**.

## Measured source baseline

- ZIP integrity: **passed** (`ZipFile.testzip()` returned `None`).
- ZIP SHA-256: `dcaccecd1cc6696f1dd78dc21ee482268960c3a13360e028dced50827cd3a0f5`.
- Archive entries: **9,725** including directories; **8,181 regular files**.
- Root package: `@logto/root`; `@logto/core` version **1.45.0**. Other workspace components can have differing versions; do not treat all packages as v1.45.0.
- Root and core licence: **MPL-2.0** (full licence retained verbatim in upstream source).
- Node engine: `^22.23.4 || ^24.22.1 || ^26.12.1`; pnpm: `^9.0.0 || ^10.0.0`.
- pnpm workspace: `packages/*`, `packages/toolkit/*`, `packages/connectors/*` (templates excluded).
- Source **does not contain `.git` commit metadata**, so an exact upstream SHA is not verified. Pin a genuine upstream Git release/commit before production maintenance.

## Reuse versus build

| Responsibility | Reuse from Logto | Titan Central extension |
|---|---|---|
| Login/OIDC/MFA/sessions | `packages/core`, `packages/experience`, `packages/account` | Branded sign-on and app configuration, no custom token issuer |
| Organisation membership/invitation | Core organisation queries/routes and console org pages | Cross-app mappings and business onboarding workflow |
| Roles/permissions | Logto application & org permission support | Consistent per-app resource scopes and product entitlements |
| Management API | Logto management routes and API types | Titan-only control-plane APIs (separate service) |
| Commerce | No trusted complete Titan billing subsystem found in this audit | Subscriptions, invoices/entitlements integration; separate from core |
| Data synchronisation | Not supplied as Desk/Field/Academy business data sync | Governed adapters, event outbox, verified tenant boundaries |
| Academy qualifications | Not supplied by Logto | Remains owned by Academy; Field consumes via verified API |

## Verified source locations

- `packages/core/src/queries/organization/` contains organisation membership and relation querying.
- `packages/core/src/libraries/organization-invitation.ts` handles invitation logic.
- `packages/core/src/routes-me/tenant-organization.ts` includes self-service organisation functionality.
- `packages/console/src/pages/` provides the management UI and organisation-role administration.
- `packages/schemas/` and CLI database utilities are the canonical schema/migration-related components. Inspect their actual behaviour before adapting any database.
- `docker-compose.yml` explicitly says **demonstration only** and uses `postgres:17-alpine` and host ports 3001/3002.

## Deployment compatibility blockers

1. Existing Titan Desk uses **port 3001**; never run unmodified demo Compose on the same host.
2. Existing production PostgreSQL is **13.23**. The example Compose uses PostgreSQL **17**, but that alone is **not** a proven hard minimum supported version. Verify actual Logto database constraints and run in an isolated supported DB instance before deployment.
3. The Node engine requirement is recent and strict. Verify the real DirectAdmin host Node, pnpm, disk and process manager before choosing native deployment/containerisation.
4. Do not change Desk or Field `.env`, RLS policies, databases or current reverse proxy while installing Central.
5. Tenant IDs must come from verified Logto organisation claims and current membership checks, not user-provided tenant identifiers or text company names.
6. SSO requires **OIDC Authorization Code + PKCE**, trusted redirect URIs, separate client registrations, and app-side token validation. A shared database role does not give SSO.
7. Logto MPL-2.0 permits modification/distribution subject to licence terms. Preserve licence/notices and review whether individual features are enterprise-gated or have additional terms before white labelling.

## Architecture decision record ADR-001

**Decision:** Keep the upstream Logto workspace intact. Implement `titan-central` as a distinct TypeScript control-plane service and optional console frontend, with OIDC/Management API integration. Do not inject Titan business data into Logto identity schema or fork its security-critical login/session internals.

**Central owns:** canonical identity references, org mapping, subscription entitlements, service registration and audit of cross-app permissions. **Desk owns** engagement/AI communication; **Field owns** customer/job/operations and its RLS; **Academy owns** courses/enrolments/progress/certificates.

**Proposed boundary:** Logto OIDC `sub` -> Titan app identity mapping -> current org membership -> per-application role/entitlement; queries stay in the authoritative application. Each integration must fail closed on revoked membership or unknown mapping.

## Next pass / acceptance gates

- Pass 02: implement typed central identity/organisation/entitlement contracts and app-adapter interfaces, with deterministic tests. Keep separate folders from Logto upstream source.
- Pass 03: independently install an isolated PostgreSQL instance, run build/migration only against new DB, and preserve current live apps.
- No live SSO or deployment is claimed here. **No tests of Logto functionality were run**; only source ZIP integrity and new audit-script tests are run.
