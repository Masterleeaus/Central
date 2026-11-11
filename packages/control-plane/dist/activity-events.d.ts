/** Activity history recorder and scoped reader (issue #36). Schema: migration 0011_activity_events.sql.
 *
 * Event schema (shared by Central and connected products):
 *   eventId, occurredAt, organisationId (tenant key), actorKind ('subject' | 'service'), actorId,
 *   action (dotted lower-case, e.g. membership.update), targetType, targetId,
 *   sourceProduct ('sorted' | 'supercharged' | 'lms' | 'central'), outcome ('success' | 'failure' | 'denied'),
 *   correlationId (shared across products for one lifecycle chain), detail (flat, redacted, at most 1024 bytes).
 *
 * Writing: recordActivity(conn, input) inserts on the caller's connection, so the event commits or rolls back
 * with the lifecycle change. recordActivityInOwnTransaction(pool, input) is for callers with no transaction.
 * Both refuse the event (throw) when redaction fails. Nothing is written in that case.
 *
 * Reading: queryActivity(pool, organisationId, options) runs as titan_trusted_reader with the organisation
 * scope set, and also filters by organisation_id in SQL. It never returns another organisation's rows.
 */
import type { SqlClient, SqlPool } from './postgres.js';
import type { RedactedDetail } from './activity-redaction.js';
export type ActivitySourceProduct = 'sorted' | 'supercharged' | 'lms' | 'central';
export type ActivityOutcome = 'success' | 'failure' | 'denied';
export type ActivityActorKind = 'subject' | 'service';
export interface ActivityEventInput {
    organisationId: string;
    actorKind: ActivityActorKind;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    sourceProduct: ActivitySourceProduct;
    outcome: ActivityOutcome;
    correlationId: string;
    detail?: unknown;
    /** Optional. Defaults to the database clock (now()) when omitted. */
    occurredAt?: Date;
    /** Optional. A fresh UUID is generated when omitted. */
    eventId?: string;
}
export interface PreparedActivityEvent {
    eventId: string;
    occurredAt: string | null;
    organisationId: string;
    actorKind: ActivityActorKind;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    sourceProduct: ActivitySourceProduct;
    outcome: ActivityOutcome;
    correlationId: string;
    detail: RedactedDetail['detail'];
    /** Personal-data keys removed from detail. Names only. */
    strippedDetailKeys: readonly string[];
}
export interface ActivityEventRecord {
    eventId: string;
    occurredAt: string;
    organisationId: string;
    actorKind: ActivityActorKind;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    sourceProduct: ActivitySourceProduct;
    outcome: ActivityOutcome;
    correlationId: string;
    detail: RedactedDetail['detail'];
    recordedBy: string;
}
/** Validates and redacts an event. Throws ActivityRedactionError or Error for invalid input. No I/O. */
export declare function prepareActivityEvent(input: ActivityEventInput): PreparedActivityEvent;
/** Inserts one event on the caller's connection. Call it inside the lifecycle transaction, before COMMIT.
 * The caller must already be running as titan_trusted_writer (or a role with INSERT on titan.activity_events).
 * Returns the event id. Throws, and writes nothing, if the event is refused. */
export declare function recordActivity(conn: SqlClient, input: ActivityEventInput): Promise<string>;
/** For callers with no lifecycle transaction. Opens its own transaction as titan_trusted_writer. */
export declare function recordActivityInOwnTransaction(pool: SqlPool, input: ActivityEventInput): Promise<string>;
export interface ActivityQueryOptions {
    /** Maximum rows, 1 to 100. Default 50. */
    limit?: number;
    /** Return only events strictly older than this time (keyset paging on occurred_at). */
    before?: Date;
}
/** Returns the activity for one organisation, newest first. Runs as titan_trusted_reader, scoped by
 * titan.organisation_id (migration 0011 policy), and filtered by organisation_id in SQL. Callers must
 * authorise the caller's right to read this organisation before calling; this function does not know roles. */
export declare function queryActivity(pool: SqlPool, organisationId: string, options?: ActivityQueryOptions): Promise<ActivityEventRecord[]>;
