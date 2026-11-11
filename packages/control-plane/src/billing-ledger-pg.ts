/** PostgreSQL implementations of the billing ledger and entitlement reader (issue #35). Tables: migration 0015.
 * The ledger writes run as titan_trusted_writer (SET LOCAL ROLE per transaction), like provisioning does.
 * The per-subscription lock is a session advisory lock held on one connection for the whole task, so the
 * ledger transactions and the provisioning transactions (their own connections) never wait on each other's row locks.
 */
import type { ApplicationId } from './contracts.js';
import { withCentralReadSnapshot, type SqlClient, type SqlPool } from './postgres.js';
import type { SubscriptionState } from './subscription-model.js';
import type {
  BillingLedger, EntitlementReader, EntitlementRow, LedgerDisposition, LedgerEventKey, LedgerTx, SubscriptionRecord,
} from './subscription-lifecycle.js';

const LOCK_KEY = (provider: string, subscriptionId: string): string => `billing:${provider}:${subscriptionId}`;

async function inWriterTransaction<T>(conn: SqlClient, task: () => Promise<T>): Promise<T> {
  await conn.query('BEGIN');
  try {
    await conn.query('SET LOCAL ROLE titan_trusted_writer');
    await conn.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await task();
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    try { await conn.query('ROLLBACK'); } catch { /* the original error is the one to report */ }
    throw error;
  }
}

class PostgresLedgerTx implements LedgerTx {
  constructor(private readonly conn: SqlClient) {}

  beginEvent(event: LedgerEventKey) {
    return inWriterTransaction(this.conn, async () => {
      const inserted = await this.conn.query(
        "INSERT INTO titan.billing_events (provider, provider_event_id, subscription_id, occurred_at, disposition) VALUES ($1,$2,$3,$4,'pending') ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING disposition",
        [event.provider, event.providerEventId, event.subscriptionId, event.occurredAt]);
      if (inserted.rowCount === 1) return { kind: 'new' as const };
      const existing = await this.conn.query('SELECT disposition FROM titan.billing_events WHERE provider=$1 AND provider_event_id=$2', [event.provider, event.providerEventId]);
      if (existing.rows.length !== 1) throw Error('billing event could not be read back');
      return { kind: 'existing' as const, disposition: String(existing.rows[0]!['disposition']) as LedgerDisposition };
    });
  }

  subscription(provider: string, subscriptionId: string) {
    return inWriterTransaction(this.conn, async (): Promise<SubscriptionRecord | undefined> => {
      const r = await this.conn.query('SELECT organisation_id, state, position_at, position_event_id FROM titan.billing_subscriptions WHERE provider=$1 AND subscription_id=$2', [provider, subscriptionId]);
      const row = r.rows[0];
      if (!row) return undefined;
      return {
        organisationId: String(row['organisation_id']),
        state: String(row['state']) as SubscriptionState,
        positionAt: new Date(row['position_at'] as string | Date).toISOString(),
        positionEventId: String(row['position_event_id']),
      };
    });
  }

  advance(provider: string, subscriptionId: string, record: SubscriptionRecord) {
    return inWriterTransaction(this.conn, async () => {
      // Insert, or move forward only. A write that would move the position backwards affects no row and fails.
      const r = await this.conn.query(
        `INSERT INTO titan.billing_subscriptions (provider, subscription_id, organisation_id, state, position_at, position_event_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (provider, subscription_id) DO UPDATE SET organisation_id=EXCLUDED.organisation_id, state=EXCLUDED.state,
           position_at=EXCLUDED.position_at, position_event_id=EXCLUDED.position_event_id, updated_at=now()
         WHERE (titan.billing_subscriptions.position_at, titan.billing_subscriptions.position_event_id) <= (EXCLUDED.position_at, EXCLUDED.position_event_id)
         RETURNING state`,
        [provider, subscriptionId, record.organisationId, record.state, record.positionAt, record.positionEventId]);
      if (r.rowCount !== 1) throw Error('subscription position regressed: event is older than the last applied one');
    });
  }

  finish(provider: string, providerEventId: string, disposition: Exclude<LedgerDisposition, 'pending'>, detail: { reason: string; requestIds: readonly string[] }) {
    return inWriterTransaction(this.conn, async () => {
      const r = await this.conn.query(
        'UPDATE titan.billing_events SET disposition=$3, reason=$4, request_ids=$5::uuid[], processed_at=now() WHERE provider=$1 AND provider_event_id=$2',
        [provider, providerEventId, disposition, detail.reason || null, [...detail.requestIds]]);
      if (r.rowCount !== 1) throw Error('billing event row missing when finishing');
    });
  }
}

export class PostgresBillingLedger implements BillingLedger {
  constructor(private readonly pool: SqlPool) {}

  async withSubscriptionLock<T>(provider: string, subscriptionId: string, task: (tx: LedgerTx) => Promise<T>): Promise<T> {
    const conn = await this.pool.connect();
    const key = LOCK_KEY(provider, subscriptionId);
    try {
      await conn.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      try {
        return await task(new PostgresLedgerTx(conn));
      } finally {
        await conn.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      }
    } finally {
      conn.release?.();
    }
  }
}

/** Reads through the access-check snapshot (titan_trusted_reader, organisation-scoped by RLS). */
export class PostgresEntitlementReader implements EntitlementReader {
  constructor(private readonly pool: SqlPool) {}

  async entitlement(organisationId: string, applicationId: ApplicationId): Promise<EntitlementRow | undefined> {
    const rows = await withCentralReadSnapshot(this.pool, organisationId, repo => repo.entitlements(organisationId, applicationId));
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      revision: row.revision,
      state: row.status as EntitlementRow['state'],
      features: [...row.features],
      expiresAt: row.expiresAt ?? null,
    };
  }
}
