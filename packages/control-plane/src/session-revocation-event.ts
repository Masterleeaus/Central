import type { SqlClient } from './postgres.js';
import { createOutboxWriter, PRODUCTION_EVENT_REGISTRY, type OutboxWriter } from './outbox.js';

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
export const SESSION_REVOKED_EVENT = {
  eventType: 'session_revoked',
  schemaVersion: 1,
  sourceProduct: 'central',
  requiredPayloadFields: ['applicationId', 'logtoSubject', 'generation'],
} as const;

export interface SessionRevokedInput {
  organisationId: string;
  applicationId: string;
  logtoSubject: string;
  generation: number;
}

/** Writes the revocation event on the caller's transaction. Throws OutboxError on invalid input, so the bump rolls back. */
export async function enqueueSessionRevoked(
  tx: SqlClient,
  input: SessionRevokedInput,
  writer: OutboxWriter = createOutboxWriter(PRODUCTION_EVENT_REGISTRY),
): Promise<'inserted' | 'replayed'> {
  return writer.enqueue(tx, {
    organisationId: input.organisationId,
    sourceProduct: SESSION_REVOKED_EVENT.sourceProduct,
    eventType: SESSION_REVOKED_EVENT.eventType,
    schemaVersion: SESSION_REVOKED_EVENT.schemaVersion,
    correlationId: 'session_revoked',
    idempotencyKey: `session_revoked:${input.organisationId}:${input.applicationId}:${input.logtoSubject}:${input.generation}`,
    payload: {
      applicationId: input.applicationId,
      logtoSubject: input.logtoSubject,
      generation: input.generation,
    },
  });
}
