# Product registry and integration contracts (issue #29)

Status: **partial**. The registry is validated at Titan Central API startup and feeds the admin plans view. The health and version probes exist as an interface and are not scheduled. The per-product request/response contracts are **DRAFT**. Renaming legacy ids and migrating records are **not done**.

## Scope and limits

- The Sorted, Supercharged and LMS code lives in other repositories. Those repositories are **not attached to this session**, so nothing in this document has been checked against their code.
- Tenant and account keys (`account_id`, `company_account_id`, `companyRef`) are **assumptions** taken from the issue text. They are not verified. Only the owning products can verify them.
- The registry makes no network calls. The only network code is the probe interface, which takes an injected fetch and is not called at startup.
- Repository identity is never a service origin and never grants access.

## Canonical products

| Product id | Legacy id | Display name | GitHub repository (identity only) | Audience | Draft contract | Tenant key (assumed) |
| --- | --- | --- | --- | --- | --- | --- |
| `sorted` | `field` | Sorted | `Masterleeaus/Sorted` | `urn:titan-central:product:sorted` | `0.1.0-draft` | `account_id` |
| `supercharged` | `desk` | Supercharged | `Masterleeaus/Supercharged` | `urn:titan-central:product:supercharged` | `0.1.0-draft` | `company_account_id` |
| `lms` | `academy` | LMS | `Masterleeaus/Skilled` | `urn:titan-central:product:lms` | `0.1.0-draft` | `companyRef` |

The LMS repository is named `Skilled`. The repository name is identity only.

Declared capabilities (draft): all products declare `health`, `version` and `tenant-link:verify`. Sorted adds `jobs:read`, `visits:read`. Supercharged adds `communications:read`, `agents:read`. LMS adds `courses:read`, `certificates:read`.

## Operator configuration (wired)

Read by `loadProductRegistry` in `apps/control-api/src/operator-config.mjs`. It runs at every startup, so invalid product configuration stops startup even when the operator plane is off. Messages name variables and rule codes, never values.

| Variable | Purpose |
| --- | --- |
| `TITAN_FIELD_ORIGIN` | Service origin for `sorted` (legacy variable name) |
| `TITAN_DESK_ORIGIN` | Service origin for `supercharged` (legacy variable name) |
| `TITAN_ACADEMY_ORIGIN` | Service origin for `lms` (legacy variable name) |
| `TITAN_PRODUCT_TRUSTED_ORIGINS` | Comma-separated operator allowlist. Required whenever any origin above is set |

Rules: the three origins are set together or not at all. Each origin must be HTTPS on a public DNS name, with the default port, and with no credentials, path, query or fragment. IP literals, `localhost`, and GitHub hosts (`github.com`, `github.io`, `githubusercontent.com`) are rejected. Each origin must appear on the allowlist, and no two products may share one. Template: `deploy/env.example`.

## Rules enforced by the code

1. Product ids are a closed set (`sorted`, `supercharged`, `lms`). Unknown values are rejected, and so are legacy ids and repository names passed as product ids.
2. Ids, legacy ids, audiences and repository identities must each be unique. Every canonical product must be present.
3. Each legacy id maps to exactly one product, and the mapping must match the table above.
4. Contract versions use `MAJOR.MINOR.PATCH` with an optional `-draft` suffix.
5. Each product declares every required capability and uses its own expected tenant key.
6. Origin rules as listed above (`normaliseTrustedOrigin`).
7. An origin must appear on `trustedOrigins`, and no two products may share one.
8. A repository match returns `accessGranted: false` as a literal type. Repository identity never grants access and never yields an origin. Access checks do not take a repository as input.
9. A cross-tenant request is one where the requested tenant key differs from the key verified by the owning product. A missing key on either side is also rejected.
10. Contract inspection (`inspectProductContract`) is pure. It flags a missing or mismatched version, a missing required capability, and a capability the product does not declare.

## Runtime lookup (wired)

- `planLookup(registry)` returns, per legacy id, the canonical `productId`, `displayName` and the validated `serviceOrigin`. It fails with `missing_origin` if any product has no origin.
- `originsForLegacyIds(registry)` gives the legacy-keyed origins used to build the OIDC plans.
- `GET /v1/admin/oidc/plans` adds `productId`, `legacyId` and `displayName` to each application entry. Origins come only from the registry. The response still reports `registrationStatus: not_registered`.
- Access checks in `access.ts` are **unchanged**. They still take legacy ids (`field`, `desk`, `academy`).

## Health and version probes (interface only)

`packages/control-plane/src/product-probe.ts`, `probeProduct(product, { fetch, timeoutMs, maxBodyBytes })`.

- Paths (DRAFT): `GET {serviceOrigin}/titan/v1/health` must return `200` with `{"status":"ok"}`. `GET {serviceOrigin}/titan/v1/version` must return `200` with `{"contractVersion": "...", "capabilities": [...]}`, which is checked with `inspectProductContract`.
- Requests use `redirect: manual`. Any 3xx is reported as `redirect` and not followed. There is a timeout (default 2000 ms), enforced even if fetch ignores the signal. Bodies are capped (default 4096 bytes). No credentials are sent.
- Failures are reason codes: `not_configured`, `timeout`, `network_error`, `redirect`, `http_status`, `body_too_large`, `invalid_body`, `health_not_ok`, `contract_incompatible`. Remote error text is never returned.
- A product with no validated origin is never fetched.
- The probe result is informational. It is not read by access checks, entitlements or the plans. A failing probe reports `healthy: false` and changes nothing else. Tests cover this.

## Legacy-to-canonical mapping

| Legacy (`ApplicationId`, `applications.ts`) | Canonical (`ProductId`) |
| --- | --- |
| `field` | `sorted` |
| `desk` | `supercharged` |
| `academy` | `lms` |

- The mapping is used in the plans view labels and the registry. Stored records and access checks still use legacy ids.
- Display labels in `applications.ts` (`Titan Field`, `Titan Desk`, `Titan Academy`) are unchanged.

## Not done, and why

- **Renaming ids.** `field`, `desk` and `academy` are stored in entitlements, local account links, OIDC client env keys and the Logto applications. Changing them silently would relabel existing records and break access decisions. The issue forbids silent relabelling. The env variable names keep their legacy suffixes for the same reason.
- **Migrating existing records.** No data is moved. A migration needs a written plan, a dual-read window, and a backfill that the owning products verify.
- **Verifying tenant keys (owning products).** Sorted must confirm `account_id`, Supercharged must confirm `company_account_id`, and LMS must confirm `companyRef`, each for its own accounts. Central cannot check these from this repository. Until then the keys stay assumptions and no cross-tenant check is backed by a verified key.
- **Per-product contracts.** Request/response shapes, auth flows (client-credentials audience per product) and the health/version paths are **DRAFT**. They must be agreed with each product's repository owner before they are treated as stable.
- **Scheduling probes.** Nothing calls `probeProduct` at runtime yet. Deciding where probe results are shown, and how often they run, is a product decision.
- **Product calls.** Nothing in Central calls product service endpoints for data yet.
- **Product-side verification.** None of this has been checked against the Sorted, Supercharged or Skilled code, which is not attached to this session.

## Acceptance criteria status (issue #29)

- Central registers and inspects each product from trusted configuration: **partially met**. Origins load and validate at startup and feed the plans view. Probes exist but are not scheduled, and nothing is inspected live.
- Distinct audience and documented contract per product: **partially met**. Audiences are distinct. Contracts are DRAFT and unverified against the product repositories.
- Tenant and account mapping verified by the owning product: **not met**. The keys are assumptions only.
- Unknown products, duplicate IDs/origins, untrusted origins and cross-tenant requests rejected: **met for the registry and startup**, covered by `packages/control-plane/test/product-registry.test.mjs` and `apps/control-api/test/product-registry-config.test.mjs`. Cross-tenant rejection is a pure check (`checkTenantReference`) and is not yet enforced on any product request path.
- Migration documented, records preserved, no silent relabelling: **partially met**. The mapping is documented. The migration itself is not done, and existing records are untouched.

## Contract versions

| Contract | Version | Status |
| --- | --- | --- |
| Registry module (`product-registry.ts`) | `0.1.0` | Implemented, validated at startup |
| Probe module (`product-probe.ts`) | `0.1.0` | Implemented, not scheduled |
| Per-product draft contract (`sorted`, `supercharged`, `lms`) | `0.1.0-draft` | DRAFT, unverified |

A product whose configured contract version differs from `0.1.0-draft` is reported as `contract_version_mismatch` (inspection) or `contract_incompatible` (probe). A product that reports a different version is not authorised by this registry.
