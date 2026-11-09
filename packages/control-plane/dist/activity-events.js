import { assertSafeText, redactActivityDetail } from './activity-redaction.js';
/** Event ids are generated here, not by RETURNING. A writer INSERT ... RETURNING needs the writer's SELECT
 * policy to pass on the new row, which is organisation-scoped (migration 0011), so it would fail in provisioning. */
const randomUuid = () => globalThis.crypto.randomUUID();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;
const TARGET_TYPE = /^[a-z][a-z0-9_]{0,31}$/;
const CORRELATION = /^[A-Za-z0-9._:-]{8,128}$/;
const SOURCES = ['sorted', 'supercharged', 'lms', 'central'];
const OUTCOMES = ['success', 'failure', 'denied'];
/** Validates and redacts an event. Throws ActivityRedactionError or Error for invalid input. No I/O. */
export function prepareActivityEvent(input) {
    if (typeof input.organisationId !== 'string' || !UUID.test(input.organisationId))
        throw new Error('activity event requires an organisation');
    if (input.actorKind !== 'subject' && input.actorKind !== 'service')
        throw new Error('invalid activity actor kind');
    const actorId = assertSafeText('actorId', input.actorId, 256);
    if (typeof input.action !== 'string' || input.action.length > 64 || !ACTION.test(input.action))
        throw new Error('invalid activity action');
    if (typeof input.targetType !== 'string' || !TARGET_TYPE.test(input.targetType))
        throw new Error('invalid activity target type');
    const targetId = assertSafeText('targetId', input.targetId, 128);
    if (!SOURCES.includes(input.sourceProduct))
        throw new Error('invalid activity source product');
    if (!OUTCOMES.includes(input.outcome))
        throw new Error('invalid activity outcome');
    if (typeof input.correlationId !== 'string' || !CORRELATION.test(input.correlationId))
        throw new Error('invalid activity correlation id');
    const eventId = input.eventId ?? randomUuid();
    if (!UUID.test(eventId))
        throw new Error('invalid activity event id');
    if (input.occurredAt !== undefined && !(input.occurredAt instanceof Date && Number.isFinite(input.occurredAt.valueOf())))
        throw new Error('invalid activity time');
    // Redaction is the last check before anything is returned, so the insert never sees unredacted detail.
    const redacted = redactActivityDetail(input.detail);
    return {
        eventId,
        occurredAt: input.occurredAt ? input.occurredAt.toISOString() : null,
        organisationId: input.organisationId,
        actorKind: input.actorKind,
        actorId,
        action: input.action,
        targetType: input.targetType,
        targetId,
        sourceProduct: input.sourceProduct,
        outcome: input.outcome,
        correlationId: input.correlationId,
        detail: redacted.detail,
        strippedDetailKeys: redacted.stripped,
    };
}
const INSERT_SQL = `INSERT INTO titan.activity_events
 (event_id, occurred_at, organisation_id, actor_kind, actor_id, action, target_type, target_id, source_product, outcome, correlation_id, detail)
 VALUES ($1::uuid, COALESCE($2::timestamptz, now()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`;
/** Inserts one event on the caller's connection. Call it inside the lifecycle transaction, before COMMIT.
 * The caller must already be running as titan_trusted_writer (or a role with INSERT on titan.activity_events).
 * Returns the event id. Throws, and writes nothing, if the event is refused. */
export async function recordActivity(conn, input) {
    const event = prepareActivityEvent(input);
    await conn.query(INSERT_SQL, [
        event.eventId,
        event.occurredAt,
        event.organisationId,
        event.actorKind,
        event.actorId,
        event.action,
        event.targetType,
        event.targetId,
        event.sourceProduct,
        event.outcome,
        event.correlationId,
        JSON.stringify(event.detail),
    ]);
    return event.eventId;
}
/** For callers with no lifecycle transaction. Opens its own transaction as titan_trusted_writer. */
export async function recordActivityInOwnTransaction(pool, input) {
    prepareActivityEvent(input); // refuse before connecting
    const conn = await pool.connect();
    let begun = false;
    try {
        await conn.query('BEGIN');
        begun = true;
        await conn.query('SET LOCAL ROLE titan_trusted_writer');
        await conn.query("SET LOCAL statement_timeout = '5000ms'");
        const eventId = await recordActivity(conn, input);
        await conn.query('COMMIT');
        begun = false;
        return eventId;
    }
    catch (error) {
        if (begun) {
            try {
                await conn.query('ROLLBACK');
            }
            catch { /* original error remains authoritative */ }
        }
        throw error;
    }
    finally {
        conn.release?.();
    }
}
/** Returns the activity for one organisation, newest first. Runs as titan_trusted_reader, scoped by
 * titan.organisation_id (migration 0011 policy), and filtered by organisation_id in SQL. Callers must
 * authorise the caller's right to read this organisation before calling; this function does not know roles. */
export async function queryActivity(pool, organisationId, options = {}) {
    if (typeof organisationId !== 'string' || !UUID.test(organisationId))
        throw new Error('organisation scope required');
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error('invalid activity page size');
    if (options.before !== undefined && !(options.before instanceof Date && Number.isFinite(options.before.valueOf())))
        throw new Error('invalid activity cursor');
    const conn = await pool.connect();
    let begun = false;
    try {
        await conn.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        begun = true;
        await conn.query('SET LOCAL ROLE titan_trusted_reader');
        await conn.query("SELECT set_config('titan.organisation_id', $1, true)", [organisationId]);
        await conn.query("SET LOCAL statement_timeout = '5000ms'");
        const result = await conn.query(`SELECT event_id, occurred_at, organisation_id, actor_kind, actor_id, action, target_type, target_id,
           source_product, outcome, correlation_id, detail, recorded_by
      FROM titan.activity_events
     WHERE organisation_id = $1 AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz)
     ORDER BY occurred_at DESC, event_id DESC
     LIMIT $3`, [organisationId, options.before ? options.before.toISOString() : null, limit]);
        const records = result.rows.map((row) => {
            if (String(row['organisation_id']) !== organisationId)
                throw new Error('activity scope violation');
            return {
                eventId: String(row['event_id']),
                occurredAt: new Date(String(row['occurred_at'])).toISOString(),
                organisationId: String(row['organisation_id']),
                actorKind: String(row['actor_kind']),
                actorId: String(row['actor_id']),
                action: String(row['action']),
                targetType: String(row['target_type']),
                targetId: String(row['target_id']),
                sourceProduct: String(row['source_product']),
                outcome: String(row['outcome']),
                correlationId: String(row['correlation_id']),
                detail: (row['detail'] ?? {}),
                recordedBy: String(row['recorded_by']),
            };
        });
        await conn.query('COMMIT');
        begun = false;
        return records;
    }
    catch (error) {
        if (begun) {
            try {
                await conn.query('ROLLBACK');
            }
            catch { /* original error remains authoritative */ }
        }
        throw error;
    }
    finally {
        conn.release?.();
    }
}
