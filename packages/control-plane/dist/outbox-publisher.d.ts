import type { SqlPool } from './postgres.js';
import { type ResolvedKey, type RouteKey } from './outbox-keys.js';
/** Publisher worker. Claims due pending rows with FOR UPDATE SKIP LOCKED, sends each one through an injected
 * transport, then marks it published, schedules a retry with exponential backoff, or moves it to dead
 * once the attempt limit is reached. Delivery is at-least-once; consumers dedupe with outbox-consumer.ts.
 *
 * Tenant routing: a row is only ever sent to the route whose organisationId equals the row's organisation_id,
 * and only to a route that lists the event type. The transport receives the consumer name and tenant, never
 * another tenant's row.
 *
 * Ordering (per tenant): the claim takes a tenant's events in outbox order (created_at, id) and never claims an
 * event while an earlier event of the same tenant is still pending. So one event per tenant is in flight, and a
 * retried event is not overtaken by a later one. A dead event does not block: it is skipped, and its later events
 * go out. Replaying it later delivers it out of order. Tenants do not order against each other. See docs/EVENTS.md. */
export declare const DEFAULT_MAX_ATTEMPTS = 8;
export declare const MAX_ATTEMPTS_LIMIT = 50;
/** A route either carries one open-ended secret or a list of rotation keys (see outbox-keys.ts). */
export type ConsumerRoute = {
    readonly consumer: string;
    readonly organisationId: string;
    readonly eventTypes: readonly string[];
} & ({
    readonly secret: string;
    readonly keys?: undefined;
} | {
    readonly keys: readonly RouteKey[];
    readonly secret?: undefined;
});
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
    /** Clock in epoch milliseconds, used to choose the signing key. Injected for tests. */
    now?: () => number;
}
export interface PublishReport {
    claimed: number;
    published: number;
    failed: number;
    dead: number;
}
/** Constant-time check of an envelope signature against one secret. */
export declare function verifyEnvelopeSignature(envelope: OutboxEnvelope, secret: string): boolean;
/** Verifies against a route's keys. Accepts when any key valid at nowMs verifies. Expired and not-yet-valid keys never do. */
export declare function verifyEnvelopeWithKeys(envelope: OutboxEnvelope, keys: readonly ResolvedKey[], nowMs: number): boolean;
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
