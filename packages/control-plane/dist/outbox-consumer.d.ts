import type { OutboxTx } from './outbox.js';
import { type OutboxEnvelope } from './outbox-publisher.js';
/** Consumer side of the outbox. Delivery is at-least-once, so a handler must be idempotent.
 * handleInbound records the idempotency key and runs the effect in the caller's transaction. A duplicate
 * key returns 'duplicate' and the effect does not run again. If the effect throws, the transaction rolls back
 * and the key is not recorded, so a later delivery can retry. */
export interface ConsumerIdentity {
    readonly consumer: string;
    readonly organisationId: string;
    readonly eventTypes: readonly string[];
    readonly secret: string;
}
export type InboundOutcome = 'processed' | 'duplicate';
/** Verifies authenticity and tenant binding, then runs effect once per (consumer, idempotency key). */
export declare function handleInbound(tx: OutboxTx, consumer: ConsumerIdentity, rawEnvelope: unknown, effect: (tx: OutboxTx, envelope: OutboxEnvelope) => Promise<void>): Promise<InboundOutcome>;
