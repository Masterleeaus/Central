import { OutboxError, assertTenantId } from './outbox.js';
import { verifyEnvelopeSignature } from './outbox-publisher.js';
const HEX64 = /^[0-9a-f]{64}$/;
function parseEnvelope(value) {
    const e = value;
    if (!e || typeof e !== 'object')
        throw new OutboxError('invalid_envelope', 'envelope must be an object');
    const stringFields = ['eventId', 'organisationId', 'sourceProduct', 'eventType', 'correlationId', 'idempotencyKey', 'occurredAt', 'signature'];
    for (const field of stringFields) {
        if (typeof e[field] !== 'string' || e[field].length === 0)
            throw new OutboxError('invalid_envelope', `envelope.${field} is required`);
    }
    if (!Number.isSafeInteger(e.schemaVersion) || e.schemaVersion < 1)
        throw new OutboxError('invalid_envelope', 'envelope.schemaVersion is invalid');
    if (e.payload === null || typeof e.payload !== 'object' || Array.isArray(e.payload))
        throw new OutboxError('invalid_envelope', 'envelope.payload must be an object');
    return e;
}
/** Verifies authenticity and tenant binding, then runs effect once per (consumer, idempotency key). */
export async function handleInbound(tx, consumer, rawEnvelope, effect) {
    const envelope = parseEnvelope(rawEnvelope);
    if (!verifyEnvelopeSignature(envelope, consumer.secret))
        throw new OutboxError('bad_signature', 'envelope signature does not verify');
    if (assertTenantId(envelope.organisationId) !== assertTenantId(consumer.organisationId)) {
        throw new OutboxError('tenant_mismatch', 'event belongs to another tenant');
    }
    if (!consumer.eventTypes.includes(envelope.eventType))
        throw new OutboxError('unknown_event_type', 'consumer does not accept this event type');
    const recorded = await tx.query(`INSERT INTO titan.outbox_processed_events (consumer, idempotency_key, organisation_id, event_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (consumer, idempotency_key) DO NOTHING
     RETURNING consumer`, [consumer.consumer, envelope.idempotencyKey, envelope.organisationId.toLowerCase(), envelope.eventId]);
    if ((recorded.rowCount ?? recorded.rows.length) === 0)
        return 'duplicate';
    await effect(tx, envelope);
    return 'processed';
}
