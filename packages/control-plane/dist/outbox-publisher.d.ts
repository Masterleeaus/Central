import type { SqlPool } from './postgres.js';
/** Publisher worker. Claims due pending rows with FOR UPDATE SKIP LOCKED, sends each one through an injected
 * transport, then marks it published, schedules a retry with exponential backoff, or moves it to dead
 * once the attempt limit is reached. Delivery is at-least-once; consumers dedupe with consumer.ts.
 *
 * Tenant routing: a row is only ever sent to the route whose organisationId equals the row's organisation_id,
 * and only to a route that lists the event type. The transport receives the consumer name and tenant, never
 * another tenant's row. */
export declare const DEFAULT_MAX_ATTEMPTS = 8;
export declare const MAX_ATTEMPTS_LIMIT = 50;
export interface ConsumerRoute {
    readonly consumer: string;
    readonly organisationId: string;
    readonly eventTypes: readonly string[];
    /** HMAC key shared with the consumer. Supplied at runtime from the secret store, never committed. */
    readonly secret: string;
}
export interface OutboxEnvelope {
    eventId: string;
    organisationId: string;
    sourceProduct: string;
    eventType: string;
    schemaVersion: number;
    correlationId: string;
    idempotencyKey: string;
    occurredAt: string;
    payload: Record<string, unknown>;
    /** hex HMAC-SHA256 over canonical JSON of every other field. */
    signature: string;
}
export interface PublishTarget {
    readonly consumer: string;
    readonly organisationId: string;
}
export interface PublishTransport {
    send(envelope: OutboxEnvelope, target: PublishTarget): Promise<void>;
}
export interface PublisherOptions {
    pool: SqlPool;
    transport: PublishTransport;
    routes: readonly ConsumerRoute[];
    maxAttempts?: number;
    baseBackoffSeconds?: number;
    maxBackoffSeconds?: number;
    leaseSeconds?: number;
    batchSize?: number;
    actor?: string;
}
export interface PublishReport {
    claimed: number;
    published: number;
    failed: number;
    dead: number;
}
/** Constant-time check of an envelope signature. Used by consumers. */
export declare function verifyEnvelopeSignature(envelope: OutboxEnvelope, secret: string): boolean;
/** Defence in depth: refuses to deliver a row to a route of another tenant. */
export declare function assertSameTenant(rowOrganisationId: string, route: {
    organisationId: string;
    consumer: string;
}): void;
/** Exponential backoff in seconds for the nth failed attempt (1-based), capped. */
export declare function backoffSeconds(attempt: number, base: number, cap: number): number;
export declare function createPublisher(options: PublisherOptions): {
    /** Claims one batch, sends each row, and records the outcome. Rows are processed one at a time. */
    runOnce(): Promise<PublishReport>;
};
/** Operator replay of a dead event. Explicit: the event must be dead, the operator must be named, and the
 * replay is audited. Attempts reset to zero so the full retry budget applies again. */
export declare function replayDeadEvent(pool: SqlPool, eventId: string, operator: string, reason: string): Promise<void>;
