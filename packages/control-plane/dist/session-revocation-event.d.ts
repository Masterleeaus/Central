import type { SqlClient } from './postgres.js';
import { type OutboxWriter } from './outbox.js';
/** Signed session revocation event (issue #6 and #102).
 * One event is written for every session generation bump, in the same transaction as the bump, so a rolled-back
 * revocation publishes nothing and a committed revocation cannot be lost. Delivery goes through the signed outbox
 * (outbox-publisher.ts). Products consume it and end their local sessions for the subject in that application.
 *
 * Identity: the idempotency key includes the generation, so each generation is one event. A replayed request or a
 * second instance cannot emit a second event for the same bump, because the generation is only advanced once.
 *
 * Payload: applicationId, logtoSubject and generation only. No tokens, session identifiers or profile data.
 * The organisation is the outbox tenant, so routes only deliver it to products bound to that organisation. */
export declare const SESSION_REVOKED_EVENT: {
    readonly eventType: "session_revoked";
    readonly schemaVersion: 1;
    readonly sourceProduct: "central";
    readonly requiredPayloadFields: readonly ["applicationId", "logtoSubject", "generation"];
};
export interface SessionRevokedInput {
    organisationId: string;
    applicationId: string;
    logtoSubject: string;
    generation: number;
}
/** Writes the revocation event on the caller's transaction. Throws OutboxError on invalid input, so the bump rolls back. */
export declare function enqueueSessionRevoked(tx: SqlClient, input: SessionRevokedInput, writer?: OutboxWriter): Promise<'inserted' | 'replayed'>;
