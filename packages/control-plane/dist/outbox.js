import { createHash } from 'node:crypto';
/** Transactional outbox writer. A state change and its outbox row commit or roll back together:
 * the caller passes its own transaction handle (tx) and calls enqueue inside the same transaction
 * as the state change. Nothing here opens a transaction on the caller's behalf. */
export const OUTBOX_MAX_PAYLOAD_BYTES = 4096;
export const OUTBOX_MAX_ERROR_CHARS = 512;
const MAX_DEPTH = 16;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SOURCE_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const EVENT_TYPE_RE = /^[a-z][a-z0-9_]{0,63}$/;
export class OutboxError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'OutboxError';
    }
}
/** No business events exist yet. Tests inject their own registry (for example example.v1). */
export const PRODUCTION_EVENT_REGISTRY = [];
/** Canonical JSON: object keys sorted at every depth, no whitespace. Used for the size bound and the digest. */
export function canonicalJson(value) {
    return JSON.stringify(sortKeys(value, 0));
}
function sortKeys(value, depth) {
    if (depth > MAX_DEPTH)
        throw new OutboxError('invalid_payload', 'payload nesting too deep');
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new OutboxError('invalid_payload', 'payload numbers must be finite');
        return value;
    }
    if (Array.isArray(value))
        return value.map((item) => sortKeys(item, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            const item = value[key];
            if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
                throw new OutboxError('invalid_payload', 'payload values must be JSON');
            }
            out[key] = sortKeys(item, depth + 1);
        }
        return out;
    }
    throw new OutboxError('invalid_payload', 'payload values must be JSON');
}
export function payloadDigest(canonical) {
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
/** Strips credentials and connection strings from a stored error and bounds its length. */
export function redactError(input) {
    let text = input instanceof Error ? input.message : String(input ?? '');
    text = text
        .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[redacted-url]')
        .replace(/https?:\/\/[^\s'"]+/gi, '[redacted-url]')
        .replace(/(bearer\s+)[^\s'"]+/gi, '$1[redacted]')
        .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|signature|client_secret)["']?\s*[=:]\s*["']?)[^\s'",;}]+/gi, '$1[redacted]')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .trim();
    if (text.length > OUTBOX_MAX_ERROR_CHARS)
        text = text.slice(0, OUTBOX_MAX_ERROR_CHARS - 3) + '...';
    return text || 'unknown error';
}
export function assertTenantId(value) {
    if (value === undefined || value === null || value === '')
        throw new OutboxError('missing_tenant', 'organisation_id is required');
    if (typeof value !== 'string' || !UUID_TEXT.test(value.toLowerCase())) {
        throw new OutboxError('invalid_tenant', 'organisation_id must be a UUID');
    }
    return value.toLowerCase();
}
/** Validates an event against the registry. Throws OutboxError; never touches the database. */
export function prepareEvent(registry, input) {
    const organisationId = assertTenantId(input?.organisationId);
    const { sourceProduct, eventType, schemaVersion, correlationId, idempotencyKey, payload } = input;
    if (typeof sourceProduct !== 'string' || !SOURCE_RE.test(sourceProduct))
        throw new OutboxError('invalid_field', 'sourceProduct is invalid');
    if (typeof eventType !== 'string' || !EVENT_TYPE_RE.test(eventType))
        throw new OutboxError('unknown_event_type', 'eventType is not recognised');
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1000)
        throw new OutboxError('invalid_field', 'schemaVersion is invalid');
    if (typeof correlationId !== 'string' || correlationId.length < 1 || correlationId.length > 128)
        throw new OutboxError('invalid_field', 'correlationId is invalid');
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 200)
        throw new OutboxError('invalid_field', 'idempotencyKey is invalid');
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
        throw new OutboxError('invalid_payload', 'payload must be an object');
    const definition = registry.find((d) => d.eventType === eventType && d.schemaVersion === schemaVersion);
    if (!definition)
        throw new OutboxError('unknown_event_type', `unknown event ${eventType}.v${schemaVersion}`);
    if (!definition.sourceProducts.includes(sourceProduct))
        throw new OutboxError('source_not_allowed', 'sourceProduct may not emit this event');
    const canonical = canonicalJson(payload);
    if (Buffer.byteLength(canonical, 'utf8') > OUTBOX_MAX_PAYLOAD_BYTES)
        throw new OutboxError('payload_too_large', 'payload exceeds the outbox size limit');
    return {
        organisationId, sourceProduct, eventType, schemaVersion, correlationId, idempotencyKey,
        payloadCanonical: canonical, payloadDigest: payloadDigest(canonical),
    };
}
/** Inserts one outbox row inside the caller's transaction.
 * - Same idempotency key, same tenant, type, version, source and payload: returns 'replayed' and writes nothing.
 * - Same idempotency key with any difference (including another tenant): throws idempotency_conflict.
 * correlation_id is not part of the identity; a replay with a different correlation id is still 'replayed'. */
export function createOutboxWriter(registry) {
    return {
        async enqueue(tx, input) {
            const event = prepareEvent(registry, input);
            const inserted = await tx.query(`INSERT INTO titan.outbox_events
           (organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`, [event.organisationId, event.sourceProduct, event.eventType, event.schemaVersion, event.correlationId,
                event.idempotencyKey, event.payloadCanonical, event.payloadDigest]);
            if ((inserted.rowCount ?? inserted.rows.length) > 0)
                return 'inserted';
            // Under row-level security a row from another tenant is not visible here, so no row also fails closed.
            const existing = await tx.query(`SELECT organisation_id, source_product, event_type, schema_version, payload_digest
           FROM titan.outbox_events WHERE idempotency_key = $1`, [event.idempotencyKey]);
            const row = existing.rows[0];
            const same = row !== undefined
                && String(row['organisation_id']) === event.organisationId
                && row['source_product'] === event.sourceProduct
                && row['event_type'] === event.eventType
                && Number(row['schema_version']) === event.schemaVersion
                && row['payload_digest'] === event.payloadDigest;
            if (!same)
                throw new OutboxError('idempotency_conflict', 'idempotency key was used for a different event');
            return 'replayed';
        },
    };
}
/** Runs work in one transaction on a pooled connection. Commits on success, rolls back and rethrows on error. */
export async function runInTransaction(pool, work) {
    const conn = await pool.connect();
    let begun = false;
    try {
        await conn.query('BEGIN');
        begun = true;
        const result = await work(conn);
        await conn.query('COMMIT');
        begun = false;
        return result;
    }
    catch (error) {
        if (begun) {
            try {
                await conn.query('ROLLBACK');
            }
            catch { /* the original error stays authoritative */ }
        }
        throw error;
    }
    finally {
        conn.release?.();
    }
}
