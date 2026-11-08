# Titan Central

Titan Central is the shared identity, organisation-access and product-entitlement service for Sorted, Supercharged and LMS. It keeps each product's users, account data and operational permissions in that product while providing one governed access layer.

## Integrated products

| Product | Repository | Central ID |
|---|---|---|
| Sorted | [Masterleeaus/Sorted](https://github.com/Masterleeaus/Sorted) | `sorted` |
| Supercharged | [Masterleeaus/Supercharged](https://github.com/Masterleeaus/Supercharged) | `supercharged` |
| LMS | [Masterleeaus/Skilled](https://github.com/Masterleeaus/Skilled) | `lms` |

## One source workspace

The API, control-plane package, deployment gate, migrations and tests live in this repository. The root npm workspace provides the common build and test entry points.

- `apps/control-api`: HTTP API, OIDC verification, app-local sessions and revocation adapters.
- `packages/control-plane/src`: canonical TypeScript authorization and provisioning source.
- `packages/control-plane/dist`: generated output consumed by the API; the root build refreshes it.
- `migrations`: draft schema for a dedicated Titan Central PostgreSQL database.
- `deploy`: non-secret staging example and read-only preflight gate.

Logto remains an external identity provider. This repository contains its source audit and inventory, but **does not contain the upstream Logto workspace**. The source packages keep clear boundaries and are linked through npm workspaces.

## Requirements and commands

Node.js 22 or later is required. From the repository root:

```sh
npm install
npm run build
npm test
npm run test:preflight
```

The test command builds the control-plane TypeScript before running its tests and the API tests. Preflight tests use Python 3.

## Deployment status

The staging configuration is an example, not live deployment evidence. OIDC, PostgreSQL migrations, product adapters, tenant isolation, global logout and rollback remain unverified until exercised against the actual services. See [the documentation index](docs/README.md), [the deployment runbook](PASS15_DEPLOYMENT_RUNBOOK.md) and [the architecture decisions](TITAN_ARCHITECTURE_DECISIONS.md).
