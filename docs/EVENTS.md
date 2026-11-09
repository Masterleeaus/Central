# Cross-product event contract

Status: contract and mechanism only. No business event is approved yet, so the production registry is empty
(`PRODUCTION_EVENT_REGISTRY` in `packages/control-plane/src/outbox.ts`). The only event defined in the repository is
`example.v1`, which exists for tests. Adding a business event means adding a reviewed registry entry, a section here,
and a consumer decision. It does not happen as a side effect of this document.

Central coordinates handoffs between products. Each product stays authoritative for its own records: an event
carries the minimum data needed for the handoff, not a copy of the product's state.

## Components

| Part | Where | Role |
| --- | --- | --- |
| Outbox table | `titan.outbox_events` (migration 0012) | One row per event, written in the state change's transaction. |
| Writer | `createOutboxWriter` in `outbox.ts` | Validates and inserts through the caller's transaction handle. |
| Publisher | `createPublisher` in `outbox-publisher.ts` | Claims due rows, signs, sends through an injected transport, records the outcome. |
| Operator replay | `replayDeadEvent` in `outbox-publisher.ts` | The only way a dead event returns to pending. |
| Consumer helper | `handleInbound` in `outbox-consumer.ts` | Verifies the envelope and runs an effect once per idempotency key. |
| Audit | `titan.outbox_event_audit` | Append-only record of publishes, failed attempts, dead letters and replays. |
| Consumer dedupe | `titan.outbox_processed_events` | Records consumer, idempotency key and event id. |

The transport is an interface (`send(envelope, target)`). This repository ships no network transport, so events are not
delivered anywhere until a transport and a worker entry point are added.

## Envelope

| Field | Type | Rule |
| --- | --- | --- |
| `eventId` | UUID | Row id, assigned by the database. |
| `organisationId` | UUID | Tenant. Required. Routing and consumer checks use this field. |
| `sourceProduct` | slug | Lower-case, `^[a-z][a-z0-9_-]{0,63}$`. Must be listed for the event in the registry. |
| `eventType` | slug | Lower-case, `^[a-z][a-z0-9_]{0,63}$`. Must be in the registry. |
| `schemaVersion` | integer >= 1 | Versions the payload schema for `eventType`. |
| `correlationId` | string, 1 to 128 | Traces a workflow across products. Not part of the event's identity. |
| `idempotencyKey` | string, 1 to 200 | Chosen by the producer. Unique across the outbox. |
| `occurredAt` | ISO time | When the outbox row was created. |
| `payload` | JSON object | Canonical JSON at most 4096 bytes. Minimum data only. |
| `signature` | hex HMAC-SHA256 | Over the canonical JSON of every other field, keyed by the consumer's route secret. |

Event name in prose: `<eventType>.v<schemaVersion>`, for example `example.v1`.

## Writing an event

1. Inside the transaction that changes the product's state, call `writer.enqueue(tx, input)`. Commit or roll back with
   the state change. A rolled-back state change leaves no outbox row (verified on PostgreSQL 16).
2. Results: `inserted` for a new event; `replayed` when the same key arrives again with the same tenant, event type,
   version, source and payload.
3. Errors (no row is written):

| Code | Cause |
| --- | --- |
| `missing_tenant`, `invalid_tenant` | No organisation id, or not a UUID. |
| `unknown_event_type` | Type or version not in the registry. |
| `source_not_allowed` | Source product is not listed for this event. |
| `invalid_field` | A field is outside its bound. |
| `invalid_payload` | Not an object, not JSON, or nesting too deep. |
| `payload_too_large` | Canonical payload over 4096 bytes. |
| `idempotency_conflict` | Same key with any difference, including a different tenant. |

Idempotency keys are the producer's contract. Use a key that is stable across retries of the same business action
(for example, the product's own record id plus the transition). A new business action gets a new key. Reusing a key
for different data is a bug and is refused.

## Delivery and routing

- Delivery is at least once. A consumer must handle duplicates and delays.
- A row goes only to the route whose `organisationId` equals the row's tenant and whose event types include its type.
  Two routes may not share a tenant and event type. A row with no matching route stays pending and is retried until
  it is dead, so the gap is visible.
- The publisher checks the tenant again before sending. A consumer also rejects an envelope whose tenant differs
  from its own binding (`tenant_mismatch`), even if the signature is valid.
- Each route has its own secret (at least 32 characters), supplied at runtime from the secret store. Secrets are not
  committed, and not placed in events or logs. Rotation is not implemented: rotating means replacing the route secret
  in configuration and restarting the publisher and consumer together.

## Retries, dead letters and replay

- Each claim increments `attempts` and leases the row for 60 seconds (`next_attempt_at`).
- A failed send sets `next_attempt_at` to now plus `5s * 2^(attempts-1)`, capped at 900s. Defaults give 8 attempts.
- After the last failed attempt the row becomes `dead`. Dead rows are never claimed.
- `last_error` keeps the last failure, redacted (URLs, bearer tokens, password-like values) and at most 512 characters.
- Replay is explicit: `replayDeadEvent(pool, eventId, operator, reason)`. It requires a named operator and a reason, works
  only on dead rows, resets `attempts` to 0, and writes an `operator_replay` audit row. Nothing replays automatically.
- Observability: query `titan.outbox_events` by `status`, and `titan.outbox_event_audit` for history. The pending index
  covers due work and the dead index covers dead letters.

## Row states

`pending` to `published` (terminal). `pending` to `dead` after the attempt limit. `dead` back to `pending` only by
operator replay. Identity fields (tenant, source, type, version, correlation id, idempotency key, payload, digest,
created time) cannot change; the database enforces this.

## Consumer rules

1. Verify the signature and the tenant binding before doing anything else.
2. Run the effect in the same transaction as the `titan.outbox_processed_events` insert. A duplicate key returns
   `duplicate` and does not repeat the effect. A failed effect rolls the key back, so a later delivery can retry.
3. Ignore unknown fields in a payload. Reject a schema version you do not support.

## Versioning rules

- Versions are integers per event type, starting at 1. A version is never reused or changed after it is published.
- Adding an optional field is allowed within the same version. Consumers must ignore fields they do not know.
- Any other change (removing or renaming a field, changing its meaning or type, making an optional field required)
  requires a new version. Publish the new version alongside the old one until every consumer has moved.
- Retire an old version only after every route has stopped accepting it and no pending row carries it.
- Event type names are not reused for a different meaning.

## Data and security rules

- Publish only what the consuming product needs for the handoff. Do not send credentials, session data, or the
  whole record.
- Payloads are bounded at 4096 bytes canonical JSON. The database also refuses payloads over 8192 bytes of jsonb text.
- Tenants are never inferred from payload content; they come from `organisationId`.
- Row-level security: a tenant-scoped role can insert and read only its own tenant's rows. Only
  `titan_trusted_writer` (the publisher and operator replay) sees all tenants, and it is never granted to a
  browser-facing role.

## Verification

- Unit tests: `packages/control-plane/test/outbox*.test.mjs`.
- PostgreSQL 16 SQL test: `tests/sql/outbox.sql` (run as superuser against migrations 0001 to 0009 and 0012; runs in CI).
- Node harness run against PostgreSQL 16 (not committed; run against a throwaway database): atomicity through the
  transaction handle, writer rules, tenant routing, backoff and dead letter, operator replay, concurrent publishers,
  and consumer dedupe.
