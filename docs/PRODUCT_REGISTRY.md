# Product registry and integration contracts (issue #29)

Status: **partial**. The canonical registry is implemented in `packages/control-plane/src/product-registry.ts`. The per-product request/response contracts are **DRAFT**. The rename of legacy ids and the record migration are **not done**.

## Scope and limits

- The Sorted, Supercharged and LMS code lives in other repositories. Those repositories are **not attached to this session**, so nothing in this document has been checked against their code.
- Account keys (`account_id`, `company_account_id`, `companyRef`) are **assumptions** taken from the issue text. They are not verified.
- No network calls are made by the registry. Runtime origins come from operator configuration only.

## Canonical products

| Product id | Legacy id | Display name | GitHub repository | Audience | Draft contract | Tenant key (assumed) |
| --- | --- | --- | --- | --- | --- | --- |
| `sorted` | `field` | Sorted | `Masterleeaus/Sorted` | `urn:titan-central:product:sorted` | `0.1.0-draft` | `account_id` |
| `supercharged` | `desk` | Supercharged | `Masterleeaus/Supercharged` | `urn:titan-central:product:supercharged` | `0.1.0-draft` | `company_account_id` |
| `lms` | `academy` | LMS | `Masterleeaus/Skilled` | `urn:titan-central:product:lms` | `0.1.0-draft` | `companyRef` |

The legacy mapping follows the order in issue #29 (field/desk/academy respectively map to Sorted/Supercharged/LMS). Note that the LMS repository is named `Skilled`. The repository name is identity only.

Declared capabilities (draft):

- All products: `health`, `version`, `tenant-link:verify` (required).
- Sorted: `jobs:read`, `visits:read`.
- Supercharged: `communications:read`, `agents:read`.
- LMS: `courses:read`, `certificates:read`.

## Rules enforced by the code

1. Product ids are a closed set (`sorted`, `supercharged`, `lms`). Unknown values are rejected, and so are legacy ids and repository names passed as product ids.
2. Ids, legacy ids, audiences and repository identities must each be unique. Every canonical product must be present.
3. Each legacy id maps to exactly one product, and the mapping must match the table above.
4. Contract versions use `MAJOR.MINOR.PATCH` with an optional `-draft` suffix.
5. Each product declares every required capability and uses its own expected tenant key.
6. A service origin must be HTTPS, on a public DNS name, with the default port and no credentials, path, query or fragment. IP literals, `localhost` and GitHub hosts (`github.com`, `github.io`, `githubusercontent.com`) are rejected.
7. An origin must appear on the operator's `trustedOrigins` allowlist, and no two products may share one.
8. A repository match returns `accessGranted: false` as a literal type. Repository identity never grants access and never yields an origin.
9. A cross-tenant request is one where the requested tenant key differs from the key verified by the owning product. A missing key on either side is also rejected.
10. Contract inspection (`inspectProductContract`) is a pure function. It flags a missing or mismatched version, a missing required capability, and a capability the product does not declare.

## Legacy-to-canonical mapping

| Legacy (`ApplicationId`, `applications.ts`) | Canonical (`ProductId`) |
| --- | --- |
| `field` | `sorted` |
| `desk` | `supercharged` |
| `academy` | `lms` |

Status of the mapping:

- **Added, additive.** `LEGACY_TO_PRODUCT`, `toCanonicalProductId` and `toLegacyApplicationId` exist. Nothing reads them yet.
- The access checks in `access.ts`, the OIDC registrations in `applications.ts`, the entitlements, the links and the Logto application records still use the legacy ids.
- Display labels in `applications.ts` (`Titan Field`, `Titan Desk`, `Titan Academy`) are unchanged. They differ from the canonical display names.

## Not done, and why

- **Renaming ids.** `field`, `desk` and `academy` are stored in entitlements, local account links, OIDC client env keys and the Logto applications. Changing them silently would relabel existing records and break access decisions. The issue forbids silent relabelling.
- **Migrating existing records.** No data is moved. A migration needs a documented plan, a dual-read window, and a backfill that the owning products verify. None of that is written here.
- **Verifying tenant keys.** Only the owning products can confirm `account_id`, `company_account_id` and `companyRef`. The registry only records them as assumptions.
- **Per-product contracts.** The request/response shapes, auth flows (client-credentials audience per product) and health/version endpoints are **DRAFT** and must be agreed with each product's repository owner before they are treated as stable.
- **Runtime wiring.** Nothing in Central calls the product origins yet. Operators must set them through `ProductOperatorConfig`.

## Acceptance criteria status (issue #29)

- Central registers and inspects each product from trusted configuration: **partially met**. `buildProductRegistry` and `inspectProductContract` exist. No live health or version check exists, and the origins are not wired to any deployment config.
- Distinct audience and documented contract per product: **partially met**. Audiences are distinct. Contracts are DRAFT and unverified against the product repositories.
- Tenant and account mapping verified by the owning product: **not met**. The keys are assumptions only.
- Unknown products, duplicate ids/origins, untrusted origins and cross-tenant requests rejected: **met for the pure registry**, covered by `test/product-registry.test.mjs`. Enforcement at runtime is not wired.
- Migration documented, records preserved, no silent relabelling: **partially met**. The mapping is documented. The migration itself is not done, and existing records are untouched.

## Contract versions

| Contract | Version | Status |
| --- | --- | --- |
| Registry module (`product-registry.ts`) | `0.1.0` (package `0.9.0`) | Implemented, additive |
| Per-product draft contract (`sorted`, `supercharged`, `lms`) | `0.1.0-draft` | DRAFT, unverified |

A product whose configured contract version differs from `0.1.0-draft` is reported as `contract_version_mismatch`. A product that reports a different version is not authorised by this registry.
