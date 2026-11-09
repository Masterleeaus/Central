import type { OutboxTx } from './outbox.js';
import { OutboxError, assertTenantId } from './outbox.js';
import { verifyEnvelopeWithKeys, type OutboxEnvelope } from './outbox-publisher.js';
import { resolveRouteKeys, type RouteKey } from './outbox-keys.js';

/** Consumer side of the outbox. Delivery is at-least-once, so a handler must be idempotent.
 * handleInbound records the idempotency key and runs the effect in the caller's transaction. A duplicate
 * key returns 'duplicate' and the effect does not run again. If the effect throws, the transaction rolls back
 * and the key is not recorded, so a later delivery can retry.
 *
 * Ordering: handleInbound does not reorder or buffer. It processes envelopes in the order they arrive. The
 * publisher sends each tenant's events in order, but a consumer that needs order must check it itself. A late
 * duplicate of an event that was already processed is returned as 'duplicate' and has no effect. */

/** Either one open-ended secret or a rotation key list (see outbox-keys.ts). `now` is injectable for tests. */
export type ConsumerIdentity = {
  readonly consumer: string;
  readonly organisationId: string;
  readonly eventTypes: readonly string[];
  readonly now?: () => number;
} & ({ readonly secret: string; readonly keys?: undefined } | { readonly keys: readonly RouteKey[]; readonly secret?: undefined });

export type InboundOutcome = 'processed' | 'duplicate';

function parseEnvelope(value: unknown): OutboxEnvelope {
  const e = value as Partial<OutboxEnvelope> | null;
  if (!e || typeof e !== 'object') throw new OutboxError('invalid_envelope', 'envelope must be an object');
  const stringFields: (keyof OutboxEnvelope)[] = ['eventId', 'organisationId', 'sourceProduct', 'eventType', 'correlationId', 'idempotencyKey', 'occurredAt', 'signature'];
  for (const field of stringFields) {
    if (typeof e[field] !== 'string' || (e[field] as string).length === 0) throw new OutboxError('invalid_envelope', `envelope.${field} is required`);
  }
  if (!Number.isSafeInteger(e.schemaVersion) || (e.schemaVersion as number) < 1) throw new OutboxError('invalid_envelope', 'envelope.schemaVersion is invalid');
  if (e.payload === null || typeof e.payload !== 'object' || Array.isArray(e.payload)) throw new OutboxError('invalid_envelope', 'envelope.payload must be an object');
  return e as OutboxEnvelope;
}

/** Verifies authenticity and tenant binding, then runs effect once per (consumer, idempotency key). */
export async function handleInbound(
  tx: OutboxTx,
  consumer: ConsumerIdentity,
  rawEnvelope: unknown,
  effect: (tx: OutboxTx, envelope: OutboxEnvelope) => Promise<void>,
): Promise<InboundOutcome> {
  const envelope = parseEnvelope(rawEnvelope);
  const keys = resolveRouteKeys({ consumer: consumer.consumer, secret: consumer.secret, keys: consumer.keys });
  const now = consumer.now ?? (() => Date.now());
  // Any key valid at this moment may verify. An expired or not-yet-valid key does not.
  if (!verifyEnvelopeWithKeys(envelope, keys, now())) {
    throw new OutboxError('bad_signature', 'envelope signature does not verify with a key valid now');
  }
  if (assertTenantId(envelope.organisationId) !== assertTenantId(consumer.organisationId)) {
    throw new OutboxError('tenant_mismatch', 'event belongs to another tenant');
  }
  if (!consumer.eventTypes.includes(envelope.eventType)) throw new OutboxError('unknown_event_type', 'consumer does not accept this event type');

  const recorded = await tx.query(
    `INSERT INTO titan.outbox_processed_events (consumer, idempotency_key, organisation_id, event_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (consumer, idempotency_key) DO NOTHING
     RETURNING consumer`,
    [consumer.consumer, envelope.idempotencyKey, envelope.organisationId.toLowerCase(), envelope.eventId],
  );
  if ((recorded.rowCount ?? recorded.rows.length) === 0) return 'duplicate';
  await effect(tx, envelope);
  return 'processed';
}
