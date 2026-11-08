# Titan Central — deployment and integration runbook

## Current integration targets

| Product | Repository | Central ID | Data owner |
|---|---|---|---|
| Sorted | `Masterleeaus/Sorted` | `sorted` | Sorted |
| Supercharged | `Masterleeaus/Supercharged` | `supercharged` | Supercharged |
| LMS | `Masterleeaus/Skilled` | `lms` | LMS |

The old Central identifiers `field`, `desk` and `academy` were replaced before production records existed. They are retained only in earlier pass reports as historical descriptions.

## Ownership and service boundaries

| Component | Owner | Runtime |
|---|---|---|
| Logto | Upstream identity provider | Separate service and supported PostgreSQL database |
| Titan Central | This repository | Live app source: API, control-plane package and dedicated Central PostgreSQL database |
| Sorted | `Masterleeaus/Sorted` | Product service, local user/account sessions and business data |
| Supercharged | `Masterleeaus/Supercharged` | Product service, local sessions and business data |
| LMS | `Masterleeaus/Skilled` | LMS service, local sessions, training data and caller-scoped integration API |

Logto is a separate runtime identity service. Titan Central's source and release history are in this repository; Logto remains independently maintained and deployed.

## Go/no-go requirements

1. Inventory the live host, process manager, supported Node.js and PostgreSQL versions, ports, proxy, certificates and backups. Preserve existing application files and data.
2. Provision separate Logto and Titan Central databases with least-privilege roles. Review Central migrations before applying them; never apply them to a product database.
3. Verify the deployed Logto HTTPS discovery document, JWKS, management scopes and signing-key rotation.
4. Register distinct OIDC clients for Sorted, Supercharged and LMS. Confirm each real origin, exact callback/logout URI and audience with the owning service before enabling sign-in. The example config retains legacy hostnames until deployment DNS is confirmed.
5. Implement each product's OIDC-to-local-session adapter while preserving its local authorisation checks. Central identity alone does not grant access to product data.
6. Verify identity and account links with the product that owns the account: Sorted `account_id`, Supercharged's company/account identity, and LMS `companyRef`. Never match by email or accept a client-supplied account ID as proof.
7. Do not enable tenant-scoped Supercharged access until company tenancy and data isolation are implemented and verified. Sorted must continue to enforce its account-scoped access and RLS. LMS machine credentials and tenant allowlists remain separate from interactive user sign-in.
8. Wire membership, role, entitlement and link revocation through to every app session. Prove cross-instance invalidation and account switching.
9. Verify end-to-end login, tenant isolation, logout and rollback for all three products. Enable adapters incrementally behind feature flags.
10. Production readiness requires actual Logto, database, product-adapter and two-tenant evidence. A passing preflight alone is not proof of security or live integration.

## Read-only preflight

From the repository root:

```sh
python3 deploy/preflight.py \
  --config deploy/staging.example.json \
  --root . \
  --live /path/to/live/apps
```

The checked-in example intentionally fails because the runtime, adapters and security checks have not been verified. Do not mark a check true without evidence from the corresponding live environment.

## Rollback

- Back up deployed bundles and databases before enabling product adapters.
- Keep existing product login routes available until new session flows and rollback have been exercised.
- Disable Central adapter flags first if callbacks, sessions or tenant checks fail.
- Preserve Central identity mappings and product data during rollback unless an approved recovery plan requires otherwise.

## Verified status

This repository contains the Titan Central application source and draft deployment configuration. Live Logto, database migrations, three product adapters, cross-tenant tests, global logout and production rollback have not been verified here. **This source is not production-ready.**
