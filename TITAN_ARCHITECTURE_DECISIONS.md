# Titan Central — current architecture

## Brand and product registry

Titan Central is the shared identity, organisation-access and product-entitlement service. The integrated products are registered under these canonical IDs:

| Central ID | Product | Repository |
|---|---|---|
| `sorted` | Sorted | `Masterleeaus/Sorted` |
| `supercharged` | Supercharged | `Masterleeaus/Supercharged` |
| `lms` | LMS | `Masterleeaus/Skilled` |

The old Central IDs `field`, `desk` and `academy` have been retired before production data exists. New source, test fixtures and draft schemas use the canonical IDs above.

## Source ownership

- This repository is the Titan Central application source.
- `apps/control-api` is the HTTP service and its OIDC/session adapters.
- `packages/control-plane/src` is the canonical authorisation, provisioning and product-registration source.
- `packages/control-plane/dist` is generated TypeScript output used by the API runtime; regenerate it with the root build command.
- `migrations`, `deploy`, and their tests belong to the same source base.
- Logto is a separate runtime identity service integrated by Titan Central over OIDC and the Management API. It has its own source repository and deployment lifecycle.

## Security boundaries

- Logto authenticates users; Titan Central verifies OIDC tokens and evaluates current organisation membership and product entitlements.
- Each product retains its own user, account and business data. Central stores only verified identity and product-account links.
- Sorted owns its `account_id` tenancy and RLS; Supercharged must complete and verify its company tenancy before tenant-scoped access is enabled; LMS owns `companyRef` and its service-scoped integration credentials.
- Product adapters must not infer account ownership from email, names, or client-supplied tenant values.
- OIDC audiences and service-to-service credentials remain distinct trust mechanisms.

## Runtime origins

The staging example keeps the currently configured host origins until deployment DNS and callback ownership are confirmed. Product IDs, labels and callback route identifiers use the current names. Replace the example hostnames only with verified deployment origins.
