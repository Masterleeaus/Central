import type { OutboxTx } from './outbox.js';
import { type OutboxEnvelope } from './outbox-publisher.js';
import { type RouteKey } from './outbox-keys.js';
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
} & ({
    readonly secret: string;
    readonly keys?: undefined;
} | {
    readonly keys: readonly RouteKey[];
    readonly secret?: undefined;
});
export type InboundOutcome = 'processed' | 'duplicate';
/** Verifies authenticity and tenant binding, then runs effect once per (consumer, idempotency key). */
export declare function handleInbound(tx: OutboxTx, consumer: ConsumerIdentity, rawEnvelope: unknown, effect: (tx: OutboxTx, envelope: OutboxEnvelope) => Promise<void>): Promise<InboundOutcome>;
