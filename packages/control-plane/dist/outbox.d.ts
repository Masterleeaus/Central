import type { SqlClient, SqlPool, SqlQueryResult } from './postgres.js';
/** Transactional outbox writer. A state change and its outbox row commit or roll back together:
 * the caller passes its own transaction handle (tx) and calls enqueue inside the same transaction
 * as the state change. Nothing here opens a transaction on the caller's behalf. */
export declare const OUTBOX_MAX_PAYLOAD_BYTES = 4096;
export declare const OUTBOX_MAX_ERROR_CHARS = 512;
export type OutboxErrorCode = 'missing_tenant' | 'invalid_tenant' | 'unknown_event_type' | 'source_not_allowed' | 'invalid_field' | 'invalid_payload' | 'payload_too_large' | 'idempotency_conflict' | 'bad_signature' | 'tenant_mismatch' | 'invalid_envelope' | 'not_dead' | 'not_pending' | 'route_mismatch';
export declare class OutboxError extends Error {
    readonly code: OutboxErrorCode;
    constructor(code: OutboxErrorCode, message: string);
}
/** Accepted events. The list is code, reviewed with the contract in docs/EVENTS.md. An event is accepted
 * only if its type and version are listed and the source product is listed for it. */
export interface EventDefinition {
    readonly eventType: string;
    readonly schemaVersion: number;
    readonly sourceProducts: readonly string[];
}
export type EventRegistry = readonly EventDefinition[];
/** No business events exist yet. Tests inject their own registry (for example example.v1). */
export declare const PRODUCTION_EVENT_REGISTRY: EventRegistry;
export interface OutboxTx {
    query(text: string, values?: readonly unknown[]): Promise<SqlQueryResult>;
}
export interface OutboxEventInput {
    organisationId: string;
    sourceProduct: string;
    eventType: string;
    schemaVersion: number;
    correlationId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
}
export type EnqueueOutcome = 'inserted' | 'replayed';
/** Canonical JSON: object keys sorted at every depth, no whitespace. Used for the size bound and the digest. */
export declare function canonicalJson(value: unknown): string;
export declare function payloadDigest(canonical: string): string;
/** Strips credentials and connection strings from a stored error and bounds its length. */
export declare function redactError(input: unknown): string;
export declare function assertTenantId(value: unknown): string;
export interface PreparedEvent {
    organisationId: string;
    sourceProduct: string;
    eventType: string;
    schemaVersion: number;
    correlationId: string;
    idempotencyKey: string;
    payloadCanonical: string;
    payloadDigest: string;
}
/** Validates an event against the registry. Throws OutboxError; never touches the database. */
export declare function prepareEvent(registry: EventRegistry, input: OutboxEventInput): PreparedEvent;
export interface OutboxWriter {
    enqueue(tx: OutboxTx, input: OutboxEventInput): Promise<EnqueueOutcome>;
}
/** Inserts one outbox row inside the caller's transaction.
 * - Same idempotency key, same tenant, type, version, source and payload: returns 'replayed' and writes nothing.
 * - Same idempotency key with any difference (including another tenant): throws idempotency_conflict.
 * correlation_id is not part of the identity; a replay with a different correlation id is still 'replayed'. */
export declare function createOutboxWriter(registry: EventRegistry): OutboxWriter;
/** Runs work in one transaction on a pooled connection. Commits on success, rolls back and rethrows on error. */
export declare function runInTransaction<T>(pool: SqlPool, work: (tx: SqlClient) => Promise<T>): Promise<T>;
