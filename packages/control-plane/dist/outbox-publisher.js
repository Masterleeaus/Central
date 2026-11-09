import { createHmac, timingSafeEqual } from 'node:crypto';
import { OutboxError, canonicalJson, redactError, runInTransaction, assertTenantId } from './outbox.js';
/** Publisher worker. Claims due pending rows with FOR UPDATE SKIP LOCKED, sends each one through an injected
 * transport, then marks it published, schedules a retry with exponential backoff, or moves it to dead
 * once the attempt limit is reached. Delivery is at-least-once; consumers dedupe with consumer.ts.
 *
 * Tenant routing: a row is only ever sent to the route whose organisationId equals the row's organisation_id,
 * and only to a route that lists the event type. The transport receives the consumer name and tenant, never
 * another tenant's row. */
export const DEFAULT_MAX_ATTEMPTS = 8;
export const MAX_ATTEMPTS_LIMIT = 50;
const MIN_SECRET_LENGTH = 32;
function signEnvelope(unsigned, secret) {
    return createHmac('sha256', secret).update(canonicalJson(unsigned), 'utf8').digest('hex');
}
/** Constant-time check of an envelope signature. Used by consumers. */
export function verifyEnvelopeSignature(envelope, secret) {
    const { signature, ...unsigned } = envelope;
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature))
        return false;
    const expected = Buffer.from(signEnvelope(unsigned, secret), 'hex');
    const given = Buffer.from(signature, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
}
/** Defence in depth: refuses to deliver a row to a route of another tenant. */
export function assertSameTenant(rowOrganisationId, route) {
    if (assertTenantId(rowOrganisationId) !== assertTenantId(route.organisationId)) {
        throw new OutboxError('route_mismatch', `consumer ${route.consumer} is not bound to this tenant`);
    }
}
/** Exponential backoff in seconds for the nth failed attempt (1-based), capped. */
export function backoffSeconds(attempt, base, cap) {
    const exponent = Math.min(Math.max(attempt - 1, 0), 30);
    return Math.min(cap, base * 2 ** exponent);
}
export function createPublisher(options) {
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const base = options.baseBackoffSeconds ?? 5;
    const cap = options.maxBackoffSeconds ?? 900;
    const lease = options.leaseSeconds ?? 60;
    const batchSize = options.batchSize ?? 20;
    const actor = options.actor ?? 'outbox-publisher';
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS_LIMIT)
        throw new OutboxError('invalid_field', 'maxAttempts out of range');
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
        throw new OutboxError('invalid_field', 'batchSize out of range');
    if (!(base > 0) || !(cap >= base) || !(lease > 0))
        throw new OutboxError('invalid_field', 'backoff or lease out of range');
    const seen = new Set();
    for (const route of options.routes) {
        assertTenantId(route.organisationId);
        if (route.secret.length < MIN_SECRET_LENGTH)
            throw new OutboxError('invalid_field', `secret for ${route.consumer} is too short`);
        for (const type of route.eventTypes) {
            const key = `${route.organisationId.toLowerCase()}|${type}`;
            if (seen.has(key))
                throw new OutboxError('invalid_field', `more than one consumer for ${type} in one tenant`);
            seen.add(key);
        }
    }
    function routeFor(row) {
        return options.routes.find((r) => r.organisationId.toLowerCase() === row.organisationId && r.eventTypes.includes(row.eventType));
    }
    async function claim(conn) {
        // Rows whose lease expired after the last permitted attempt go to dead rather than being claimed again.
        const expired = await conn.query(`UPDATE titan.outbox_events
          SET status = 'dead', last_error = 'lease expired after final attempt'
        WHERE id IN (
          SELECT id FROM titan.outbox_events
           WHERE status = 'pending' AND next_attempt_at <= now() AND attempts >= $1
           FOR UPDATE SKIP LOCKED)
        RETURNING id, organisation_id`, [maxAttempts]);
        for (const row of expired.rows) {
            await conn.query(`INSERT INTO titan.outbox_event_audit (event_id, organisation_id, action, actor, detail) VALUES ($1, $2, 'dead', $3, $4)`, [row['id'], row['organisation_id'], actor, 'lease expired after final attempt']);
        }
        const result = await conn.query(`WITH due AS (
         SELECT id FROM titan.outbox_events
          WHERE status = 'pending' AND next_attempt_at <= now() AND attempts < $1
          ORDER BY next_attempt_at, created_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED)
       UPDATE titan.outbox_events e
          SET attempts = e.attempts + 1,
              next_attempt_at = now() + make_interval(secs => $3::double precision)
         FROM due
        WHERE e.id = due.id
       RETURNING e.id, e.organisation_id, e.source_product, e.event_type, e.schema_version, e.correlation_id,
                 e.idempotency_key, e.payload, e.attempts, e.created_at`, [maxAttempts, batchSize, lease]);
        return result.rows.map((row) => ({
            id: String(row['id']),
            organisationId: String(row['organisation_id']),
            sourceProduct: String(row['source_product']),
            eventType: String(row['event_type']),
            schemaVersion: Number(row['schema_version']),
            correlationId: String(row['correlation_id']),
            idempotencyKey: String(row['idempotency_key']),
            payload: row['payload'],
            attempts: Number(row['attempts']),
            createdAt: new Date(String(row['created_at'])).toISOString(),
        }));
    }
    async function markPublished(id, organisationId) {
        await runInTransaction(options.pool, async (tx) => {
            const r = await tx.query(`UPDATE titan.outbox_events SET status = 'published', published_at = now(), last_error = NULL
          WHERE id = $1 AND status = 'pending' RETURNING id`, [id]);
            if (r.rows.length !== 1)
                throw new OutboxError('not_pending', 'event was not pending when published');
            await tx.query(`INSERT INTO titan.outbox_event_audit (event_id, organisation_id, action, actor) VALUES ($1, $2, 'published', $3)`, [id, organisationId, actor]);
        });
    }
    async function markFailed(id, organisationId, message) {
        const error = redactError(message);
        return runInTransaction(options.pool, async (tx) => {
            // The row is locked and its stored attempt count decides between retry and dead.
            const locked = await tx.query(`SELECT attempts FROM titan.outbox_events WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
            if (locked.rows.length !== 1)
                throw new OutboxError('not_pending', 'event was not pending when failed');
            const attempts = Number(locked.rows[0]['attempts']);
            const dead = attempts >= maxAttempts;
            await tx.query(`UPDATE titan.outbox_events
            SET status = $2,
                next_attempt_at = now() + make_interval(secs => $3::double precision),
                last_error = $4
          WHERE id = $1`, [id, dead ? 'dead' : 'pending', backoffSeconds(attempts, base, cap), error]);
            await tx.query(`INSERT INTO titan.outbox_event_audit (event_id, organisation_id, action, actor, detail) VALUES ($1, $2, 'attempt_failed', $3, $4)`, [id, organisationId, actor, error]);
            if (dead) {
                await tx.query(`INSERT INTO titan.outbox_event_audit (event_id, organisation_id, action, actor, detail) VALUES ($1, $2, 'dead', $3, $4)`, [id, organisationId, actor, `attempt limit ${maxAttempts} reached`]);
            }
            return dead ? 'dead' : 'pending';
        });
    }
    async function deliver(row) {
        const route = routeFor(row);
        if (!route)
            throw new OutboxError('route_mismatch', 'no consumer route for this tenant and event type');
        assertSameTenant(row.organisationId, route);
        const unsigned = {
            eventId: row.id,
            organisationId: row.organisationId,
            sourceProduct: row.sourceProduct,
            eventType: row.eventType,
            schemaVersion: row.schemaVersion,
            correlationId: row.correlationId,
            idempotencyKey: row.idempotencyKey,
            occurredAt: row.createdAt,
            payload: row.payload,
        };
        const envelope = { ...unsigned, signature: signEnvelope(unsigned, route.secret) };
        await options.transport.send(envelope, { consumer: route.consumer, organisationId: route.organisationId });
    }
    return {
        /** Claims one batch, sends each row, and records the outcome. Rows are processed one at a time. */
        async runOnce() {
            const report = { claimed: 0, published: 0, failed: 0, dead: 0 };
            const rows = await runInTransaction(options.pool, (conn) => claim(conn));
            report.claimed = rows.length;
            for (const row of rows) {
                try {
                    await deliver(row);
                }
                catch (error) {
                    const status = await markFailed(row.id, row.organisationId, error instanceof Error ? error.message : String(error));
                    report.failed += 1;
                    if (status === 'dead')
                        report.dead += 1;
                    continue;
                }
                await markPublished(row.id, row.organisationId);
                report.published += 1;
            }
            return report;
        },
    };
}
/** Operator replay of a dead event. Explicit: the event must be dead, the operator must be named, and the
 * replay is audited. Attempts reset to zero so the full retry budget applies again. */
export async function replayDeadEvent(pool, eventId, operator, reason) {
    if (typeof operator !== 'string' || operator.trim().length < 1 || operator.length > 200)
        throw new OutboxError('invalid_field', 'operator is required');
    if (typeof reason !== 'string' || reason.trim().length < 1 || reason.length > 512)
        throw new OutboxError('invalid_field', 'reason is required');
    if (!/^[0-9a-f-]{36}$/i.test(eventId))
        throw new OutboxError('invalid_field', 'eventId must be a UUID');
    await runInTransaction(pool, async (tx) => {
        const r = await tx.query(`UPDATE titan.outbox_events SET status = 'pending', attempts = 0, next_attempt_at = now()
        WHERE id = $1 AND status = 'dead' RETURNING organisation_id`, [eventId]);
        if (r.rows.length !== 1)
            throw new OutboxError('not_dead', 'only a dead event can be replayed');
        await tx.query(`INSERT INTO titan.outbox_event_audit (event_id, organisation_id, action, actor, detail) VALUES ($1, $2, 'operator_replay', $3, $4)`, [eventId, String(r.rows[0]['organisation_id']), operator.trim(), redactError(reason)]);
    });
}
