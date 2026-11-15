# Cross-product data contract

Status: contract document only. It records ownership, identifiers and sync direction for shared entities. It adds no
runtime behaviour, no database table and no new event type. Refs #103.

Scope: Titan Central, Sorted, Supercharged, Scheduled and LMS (`Masterleeaus/Skilled`). Each product stays the
authority for its own records. Central coordinates tenancy, identity, access and handoff events.

## Rules

1. **No direct cross-database reads.** A product never reads another product's tables or database. It uses a Central
   API or a signed event (see `EVENTS.md`).
2. **Tenant key.** Every company-owned record carries the company (organisation) it belongs to. Central's tenant key is
   `organisationId` (UUID). Events route and check tenants on `organisationId` only (see `EVENTS.md`, Components).
   A product-side id for the same company is stored as a reference, never as the tenant key.
3. **Store references, not copies.** A product stores the other product's identifier for an entity it links to, plus the
   minimum display data it needs. It does not copy another product's full record.
4. **Fail closed.** A reference with no matching tenant, or a tenant that does not match the caller, is rejected.
5. **Versioned events.** Each shared event has a type and an integer `schemaVersion` (`EVENTS.md`, Versioning rules).
   A published version is never changed.
6. **No personal data in events** beyond what the consumer needs. Customer references are opaque ids, never names,
   emails, phones or addresses.

## Shared entities

Owner and sync direction are the current intent. Entries marked **to confirm** are proposals. The owning product
confirms them in its integration issue before any code relies on them.

| Entity | Owning product | Identifier other products store | Sync direction | Event contract |
| --- | --- | --- | --- | --- |
| Company (organisation) | Central | `organisationId` (UUID) | Central to products (access and identity) | Access decisions via Central APIs. No business event. |
| Identity and membership | Central | Central identity id | Central to products | Session revocation and link assertions (`docs/LINKING.md`). |
| Customer | Sorted (to confirm) | Opaque customer reference, scoped to the company | Sorted to Supercharged and Scheduled, by reference (to confirm) | None yet. Defined when an integration issue needs it. |
| Property | Sorted (to confirm) | Opaque property reference, scoped to the company and customer | Sorted to others, by reference (to confirm) | None yet. |
| Job | Sorted (to confirm) | Opaque job reference, scoped to the company | Sorted to Supercharged (to confirm) | None yet. |
| Booking | Scheduled | `bookingId` (Scheduled id) | Scheduled to others, one way | `booking_created.v1`, `booking_cancelled.v1`, `booking_rescheduled.v1` (`EVENTS.md`). |
| Learner | LMS (`Masterleeaus/Skilled`) (to confirm) | Opaque learner reference, scoped to the company | LMS to others, by reference (to confirm) | None yet. |
| Certification | LMS (`Masterleeaus/Skilled`) (to confirm) | Opaque certification reference, scoped to the learner | LMS to others (to confirm) | None yet. |

Central owns no customer, property, job, learner or certification record. A product that needs one of these from another
product asks that product's API or receives its event. It does not read the record directly.

## Event and API shape

- **Events** use the Central outbox envelope: `eventType`, `schemaVersion`, `organisationId`, source product, idempotency
  key and payload. The field list and checks are in `EVENTS.md`.
- **APIs** between products go through Central, or through an authenticated product endpoint that checks the caller's
  audience and tenant. A product endpoint never accepts a tenant id from the request body as authority.
- A new shared event is added only with a reviewed registry entry, a section in `EVENTS.md`, and a consumer decision
  (`EVENTS.md`, status note). This document does not add one.

## Tenant-safe references

A reference from one product to another has three parts: the owning product's id, the company it belongs to, and the
source product. A consumer accepts the reference only when the company matches the verified caller's tenant. Any mismatch
returns not-found or forbidden, and the reference is not stored.

## Not verified here

- No automated test covers this document. The tests for tenant-safe references belong with each product's adapter
  (`docs/integration/` and product issues), not in this file.
- The owners marked **to confirm** are not checked against the Sorted, Supercharged or LMS repositories from this change.
- Links from each product's integration issue to this document are not added here. They are made in those repositories.
