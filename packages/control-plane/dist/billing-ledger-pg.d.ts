/** PostgreSQL implementations of the billing ledger and entitlement reader (issue #35). Tables: migration 0015.
 * The ledger writes run as titan_trusted_writer (SET LOCAL ROLE per transaction), like provisioning does.
 * The per-subscription lock is a session advisory lock held on one connection for the whole task, so the
 * ledger transactions and the provisioning transactions (their own connections) never wait on each other's row locks.
 */
import type { ApplicationId } from './contracts.js';
import { type SqlPool } from './postgres.js';
import type { BillingLedger, EntitlementReader, EntitlementRow, LedgerTx } from './subscription-lifecycle.js';
export declare class PostgresBillingLedger implements BillingLedger {
    private readonly pool;
    constructor(pool: SqlPool);
    withSubscriptionLock<T>(provider: string, subscriptionId: string, task: (tx: LedgerTx) => Promise<T>): Promise<T>;
}
/** Reads through the access-check snapshot (titan_trusted_reader, organisation-scoped by RLS). */
export declare class PostgresEntitlementReader implements EntitlementReader {
    private readonly pool;
    constructor(pool: SqlPool);
    entitlement(organisationId: string, applicationId: ApplicationId): Promise<EntitlementRow | undefined>;
}
