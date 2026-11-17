# Titan Zero integration handbook

**Status: architecture and acceptance guide — 18 November 2026.** This describes the required interfaces and evidence; it is not a claim that the five applications are integrated in production. Read [ADR-009](../TITAN_ARCHITECTURE_DECISIONS.md), [platform map](PLATFORM_MAP.md), [cross-product data contract](CROSS_PRODUCT_DATA_CONTRACT.md) and [events](EVENTS.md).

## Ownership matrix

| Concern | Authority | Consumers | Forbidden shortcut |
| --- | --- | --- | --- |
| User/company access | Central + Logto | All integrated apps | Email-only tenant selection; trusting browser company IDs |
| Booking and capacity | Scheduled | Front Desk, Sorted, Supercharged | Second writable calendar; AI committing slots |
| Jobs, quotes, invoices | Sorted | Scheduled, Supercharged, Front Desk | Shadow invoice or job writer |
| Course/competence | Skilled | Sorted, Supercharged | AI asserting unverified qualifications |
| Communications and agents | Supercharged | Front Desk and connected apps | Ungoverned direct writes into other product databases |
| Public product/pricing content | Titan Zero website, approved catalogue | Marketing | Treating marketing copy as billing entitlement |

## Required request context

Every integrated command must derive **canonical company UUID** from validated Central credentials and memberships, never an unverified request field. Require authenticated subject or service identity, audience, permitted action, object/resource scope, correlation ID, idempotency key for mutating requests, and audit metadata. Reject missing/expired/revoked context. Enforce authorization again at the receiving service and tenant-aware data layer.

## Booking handoff (target)

1. Front Desk or an approved agent requests a **read-only** availability quote from Scheduled for a verified company, service, staff/location and timezone.
2. Scheduled computes capacity, prices and business rules. A displayed slot is not a committed reservation.
3. A customer or authorized agent submits a booking command with a stable idempotency key and validated company context.
4. Scheduled atomically checks and commits availability, rejecting conflicting last-slot attempts. The result includes an authoritative booking ID and version.
5. An authenticated, versioned event notifies Sorted of job-intake eligibility and Supercharged of communications work. Consumers deduplicate by event ID and do not rebook independently.
6. Failed downstream deliveries are retried/reconciled without repeating the booking commit. Cancellation, rescheduling and refunds have explicit state transitions and audit receipts.

**Front Desk modes:** local WordPress booking remains usable when disconnected. Moving an existing site into integrated mode requires explicit authority negotiation, record mapping, in-flight booking reconciliation, cutover/rollback tests and a guarantee of no dual write. See [Front Desk architecture](https://github.com/Masterleeaus/Titan-Zero-Trades-Front-Desk/blob/main/docs/SINGLE-PLUGIN-AI-SERVICES-ARCHITECTURE.md).

## Shared database and migration gates

The target is **one physical PostgreSQL database**, one ordered, checksum-verified migration ledger, product-owned schema boundaries, distinct least-privilege service roles and canonical `company_id`. Inventory every existing migration chain (Laravel/MySQL, Prisma, Drizzle, legacy Central and Sorted), reconcile name collisions and applied checksums, then test fresh installation, upgrade, rollback and two-company row-level isolation in a disposable environment. Never apply a draft or local schema push to production. Existing independent databases are transitional and do not satisfy the target by being on the same server.

## Failure and security contract

- **Identity unavailable:** reject new privileged actions; never bypass Central verification or substitute an email address.
- **Scheduled unavailable:** no fabricated confirmation or alternate calendar write; queue only explicitly approved requests with visible pending status.
- **Supercharged unavailable:** deterministic booking and local Front Desk operations must not fail merely because an AI service is offline.
- **Event duplicate or delay:** enforce idempotency, bounded replay, dead-letter investigation and reconciliation by authoritative record ID.
- **Payments:** verify provider signatures, exact amount/currency, retry safety and refund state; no AI-authorized charge without deterministic policy.
- **Provider secrets:** service-specific credentials, rotation and redaction; no secrets in Git, docs or test output.

## Minimum end-to-end acceptance

| Gate | Evidence needed |
| --- | --- |
| Login | Real OIDC login, logout, expiry, revoked membership and cross-app audience denial |
| Tenancy | Two disposable companies; cross-company API and database access denied |
| Booking | Simultaneous last-slot attempts, timezone/DST, retry, reschedule, cancel, Front Desk cutover |
| Data | Fresh install and upgrade from inventoried schemas; one migration ledger, verified checksums |
| Messaging | Event signature, replay, retries, dead-letter recovery, consent and audit receipts |
| Commerce | Provider sandbox webhooks, idempotent payment/refund and reconciliation |
| Operations | Provider outage, backup/restore, monitoring, staged rollback and explicit go/no-go |

## Documentation and issue discipline

Treat each repository README as the implementation entry point, this handbook as the cross-product integration explanation, and GitHub issues as the current work queue. Each issue needs actionable checklist items; check them only after implementation and test evidence, and close only after all acceptance items are complete. Do not interpret a passed isolated unit test as a successful five-product cutover.
