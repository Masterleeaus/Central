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
| Key rotation | `packages/control-plane/src/outbox-keys.ts` | Route keys with validity windows; the signing and verification rules. |
| HTTP transport | `createHttpPublishTransport` in `outbox-http-transport.ts` | POSTs the signed envelope to a consumer's https URL. |
| Worker | `apps/control-api/src/outbox-worker.mjs` | Runs the publisher loop as a process, configured from environment variables, with a graceful SIGTERM stop. |

The publisher sends through the `PublishTransport` interface (`send(envelope, target)`). The shipped transport is HTTP
(see Transport below). Events leave the system only when the worker runs with routes configured.

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
  it is dead, so the gap is visible. While it is pending it also holds back its tenant's later events (see Ordering).
- The publisher checks the tenant again before sending. A consumer also rejects an envelope whose tenant differs
  from its own binding (`tenant_mismatch`), even if the signature is valid.
- Each route has one secret or up to two rotation keys (see Key rotation). Secrets are at least 32 characters and are
  supplied at runtime from the environment or the secret store. They are never committed and never placed in events,
  logs or error messages.

## Transport (HTTP)

- `createHttpPublishTransport({ endpoints, fetch, timeoutMs, allowInsecureLocalhost })` sends each envelope to the URL
  configured for its consumer. Endpoints are validated when the transport is built.
- Request: `POST <url>` with `content-type: application/json`. The body is the signed envelope as JSON. The HMAC travels
  in the envelope's `signature` field, which is the authentication. No other header is sent.
- URL rule: `https` only. `http` is accepted only for `localhost`, and only when `TITAN_ALLOW_INSECURE_LOCALHOST=1`
  (the same policy as the OIDC endpoints). A URL with credentials, a query or a fragment is refused.
- Redirects are never followed. Any 3xx answer is a failed attempt, and so is any non-2xx answer.
- Timeout: `timeoutMs` (1 to 60000, default 10000) through an `AbortSignal`. The request body is capped at 16 KiB and a
  larger envelope is refused before any request is made. The consumer's answer body is discarded, not read.
- Success is a 2xx answer, and the publisher then marks the event `published`. Failures are recorded as failed attempts
  with a redacted message such as `consumer desk-inbox answered HTTP 503`. Messages never include the URL, the body or a
  secret.
- A consumer should answer 2xx to a duplicate (`outbox-consumer` returns `duplicate`). Answering with an error makes the
  publisher retry the same event until it is dead.

## Key rotation

A route has either one `secret` (open-ended, no window) or up to two `keys`. Each key has:

| Field | Rule |
| --- | --- |
| `id` | Label of letters, digits, `_`, `.` or `-` (1 to 64). Not sent on the wire. |
| `secret` | At least 32 characters. Two keys of one route must not share a secret. |
| `notBefore`, `notAfter` | ISO 8601 instants with a time zone. Valid from `notBefore` (inclusive) to `notAfter` (exclusive). |

Rules:

- Two keys must overlap in time. A route whose keys leave a gap is refused when it is configured.
- The publisher signs with the valid key whose `notBefore` is latest (the current key). If no key is valid when an
  attempt is made, the attempt fails with `no_active_key` and is retried with backoff, as for any failure.
- A consumer accepts an envelope if any key valid at verification time verifies it. An expired key, or a key whose
  `notBefore` has not arrived, never verifies.
- The envelope carries no key id. The signature is checked against each valid key in turn.

Rotation, in order: (1) give the consumer the new key, valid from a time T0 when it is already accepting it; (2) give the
publisher `keys` with the previous key (its `notAfter` is T1) and the new key (its `notBefore` is T0, before T1), so the
publisher switches to the new key at T0; (3) after T1, remove the previous key from both sides. Leave a margin of several
minutes between T0 and T1 so that clock skew between the publisher and consumer cannot open a gap.

## Ordering

Guaranteed for one tenant:

- The publisher sends a tenant's events in outbox order: `created_at`, then `id`. A later event of a tenant is never
  claimed while an earlier event of that tenant is still pending. A pending event is leased, backed off or unrouted.
- One event of a tenant is in flight at a time, including with several publishers running at once.
- A retry is not overtaken. A failed event is sent again before anything after it.
- A dead event does not hold back its tenant. Its later events go out, and it is skipped.

Not guaranteed:

- **Across tenants.** Events of tenant A and tenant B may interleave in any order. Nothing orders one tenant against another.
- **After a dead letter.** The dead event's later events have already gone out. Replaying the dead event delivers it out of
  order. A consumer that needs strict order must treat a replayed event as out of order.
- **Between concurrent producers writing to the same tenant.** `created_at` is the time of the insert, not the commit.
  Two overlapping transactions for one tenant can commit in the opposite order to their timestamps, and the publisher
  sends rows in the order it sees them. A producer that needs strict order for a tenant must serialise its writes, for
  example by taking `pg_advisory_xact_lock` on the tenant id in the same transaction before it enqueues.
- **Rows written before the writer set `created_at` with `clock_timestamp()`.** Their `created_at` is the start of their
  transaction, so two events of one transaction tie and are ordered by `id`.
- **At the consumer.** The consumer helper does not reorder or buffer. An event that arrives before its predecessor is
  processed when it arrives. The publisher's rule is what keeps the sequence in order, not the consumer.

A late duplicate is always harmless: the consumer dedupe returns `duplicate` and runs no effect.

## Worker

Entry point: `node apps/control-api/src/outbox-worker.mjs`. A systemd template is in `deploy/outbox-worker.service`
and an environment template in `deploy/outbox-worker.env.example`. Neither is installed by this repository.

Environment variables (names only; values are set on the server):

- Required: `TITAN_OUTBOX_DATABASE_URL` (the publisher role, `titan_trusted_writer`), `TITAN_OUTBOX_ROUTES`, and the variable
  that holds each route secret.
- Optional: `TITAN_OUTBOX_POLL_INTERVAL_MS` (default 1000), `TITAN_OUTBOX_BATCH_SIZE` (20), `TITAN_OUTBOX_MAX_ATTEMPTS` (8),
  `TITAN_OUTBOX_REQUEST_TIMEOUT_MS` (10000), `TITAN_OUTBOX_SHUTDOWN_TIMEOUT_MS` (30000).
- Development only: `TITAN_ALLOW_INSECURE_LOCALHOST=1`.

`TITAN_OUTBOX_ROUTES` is a JSON array. A route names the variable that holds its secret (`secretEnv`), or lists `keys`, each
with its own `secretEnv`. A secret value never appears in the JSON.

Behaviour:

- All configuration is checked before the database is opened. Errors name the variable, never its value.
- Each cycle claims and sends one batch. A cycle that finds nothing due waits the poll interval. A failing cycle is logged
  by error code and retried after a wait that grows to at most 60 seconds. The loop does not stop by itself.
- Logs are JSON lines with an event name and counts (`outbox.started`, `outbox.batch`, `outbox.cycle_error`,
  `outbox.stopping`, `outbox.stopped`, `outbox.shutdown_timeout`). They never contain payloads, signatures, secrets, URLs or
  connection strings.
- SIGTERM or SIGINT: no new batch starts. The batch in flight finishes and the pool closes, then the process exits 0. If the
  batch is still running after `TITAN_OUTBOX_SHUTDOWN_TIMEOUT_MS`, the process exits 1 without waiting. Rows left mid-send
  keep their lease and are retried after it, so delivery stays at least once.
- Several workers may run at once. Claims use `FOR UPDATE SKIP LOCKED` and the per-tenant rule, so each tenant still has
  one event in flight.

## Retries, dead letters and replay

- Each claim increments `attempts` and leases the row for 60 seconds (`next_attempt_at`).
- A failed send sets `next_attempt_at` to now plus `5s * 2^(attempts-1)`, capped at 900s. Defaults give 8 attempts.
- While a failed event is waiting, its tenant's later events wait too (see Ordering).
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
4. Accept a route's keys during rotation: `handleInbound` takes `keys` as well as `secret`, and verifies against the keys
   valid at the consumer's clock (`now`).
5. Do not assume order. Process events as they arrive; the publisher keeps one tenant's order (see Ordering).

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

- Unit tests: `packages/control-plane/test/outbox*.test.mjs` (includes `outbox-rotation`, `outbox-transport` and
  `outbox-ordering`), and `apps/control-api/test/outbox-worker.test.mjs`. They use injected fakes and no network.
- PostgreSQL 16 SQL test: `tests/sql/outbox.sql` (run as superuser against migrations 0001 to 0009 and 0012; runs in CI).
  Section 4b checks the per-tenant claim rule. Before that rule was added, the section failed: later events of a tenant
  were claimed in the same batch as a leased head.
- Node harness against PostgreSQL 16.15 (not committed; run against a throwaway database with migrations 0001 to 0009 and
  0012 applied). It runs the real publisher, HTTP transport, writer and consumer helper, with an injected fetch that calls
  the consumer in its own PostgreSQL transaction. Seven scenarios passed: atomic rollback; per-tenant order with tenants
  never crossing and both keys valid in the overlap; a retried event not overtaken; a dead event not blocking its tenant,
  and operator replay audited; a late duplicate ignored and a tenant-bound refusal; signing with the current key after the
  previous key expires; two concurrent publishers with at most one event per tenant in flight and order kept.
  The run sent 48 requests: 44 events published, 4 failed attempts, 1 dead letter, 1 operator replay.

## Issue #40 acceptance criteria

| Criterion | Where it is met |
| --- | --- |
| State changes and outbox events commit atomically. | Writer through the caller's transaction (`outbox.ts`). SQL test section 1; harness S1. |
| Consumers can safely process duplicate or delayed events. | Consumer dedupe (`outbox-consumer.ts`); per-tenant order (SQL section 4b; harness S3, S7); late duplicate (harness S5; `outbox-ordering.test.mjs`). |
| Events are authenticated, tenant-scoped and schema-versioned. | HMAC over every field, with rotation (`outbox-keys.ts`; harness S6); tenant binding at publisher and consumer (harness S2, S5); `schemaVersion` in the envelope and registry. |
| Retries, dead letters and operator replay are observable and auditable. | `titan.outbox_event_audit` (`attempt_failed`, `dead`, `operator_replay`); worker log counts (harness S4). |
| Tests prove one tenant's events cannot be delivered to another tenant. | `outbox-transport.test.mjs` ("through the publisher"); harness S2 and S5. |

Not in this repository: consumer implementations in the other products, the production event registry (still empty),
alerting on dead letters, and automated secret rotation (rotation is done by configuration, as above).
