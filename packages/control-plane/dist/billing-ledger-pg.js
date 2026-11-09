import { withCentralReadSnapshot } from './postgres.js';
const LOCK_KEY = (provider, subscriptionId) => `billing:${provider}:${subscriptionId}`;
async function inWriterTransaction(conn, task) {
    await conn.query('BEGIN');
    try {
        await conn.query('SET LOCAL ROLE titan_trusted_writer');
        await conn.query("SET LOCAL statement_timeout = '5000ms'");
        const result = await task();
        await conn.query('COMMIT');
        return result;
    }
    catch (error) {
        try {
            await conn.query('ROLLBACK');
        }
        catch { /* the original error is the one to report */ }
        throw error;
    }
}
class PostgresLedgerTx {
    conn;
    constructor(conn) {
        this.conn = conn;
    }
    beginEvent(event) {
        return inWriterTransaction(this.conn, async () => {
            const inserted = await this.conn.query("INSERT INTO titan.billing_events (provider, provider_event_id, subscription_id, occurred_at, disposition) VALUES ($1,$2,$3,$4,'pending') ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING disposition", [event.provider, event.providerEventId, event.subscriptionId, event.occurredAt]);
            if (inserted.rowCount === 1)
                return { kind: 'new' };
            const existing = await this.conn.query('SELECT disposition FROM titan.billing_events WHERE provider=$1 AND provider_event_id=$2', [event.provider, event.providerEventId]);
            if (existing.rows.length !== 1)
                throw Error('billing event could not be read back');
            return { kind: 'existing', disposition: String(existing.rows[0]['disposition']) };
        });
    }
    subscription(provider, subscriptionId) {
        return inWriterTransaction(this.conn, async () => {
            const r = await this.conn.query('SELECT organisation_id, state, position_at, position_event_id FROM titan.billing_subscriptions WHERE provider=$1 AND subscription_id=$2', [provider, subscriptionId]);
            const row = r.rows[0];
            if (!row)
                return undefined;
            return {
                organisationId: String(row['organisation_id']),
                state: String(row['state']),
                positionAt: new Date(row['position_at']).toISOString(),
                positionEventId: String(row['position_event_id']),
            };
        });
    }
    advance(provider, subscriptionId, record) {
        return inWriterTransaction(this.conn, async () => {
            // Insert, or move forward only. A write that would move the position backwards affects no row and fails.
            const r = await this.conn.query(`INSERT INTO titan.billing_subscriptions (provider, subscription_id, organisation_id, state, position_at, position_event_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (provider, subscription_id) DO UPDATE SET organisation_id=EXCLUDED.organisation_id, state=EXCLUDED.state,
           position_at=EXCLUDED.position_at, position_event_id=EXCLUDED.position_event_id, updated_at=now()
         WHERE (titan.billing_subscriptions.position_at, titan.billing_subscriptions.position_event_id) <= (EXCLUDED.position_at, EXCLUDED.position_event_id)
         RETURNING state`, [provider, subscriptionId, record.organisationId, record.state, record.positionAt, record.positionEventId]);
            if (r.rowCount !== 1)
                throw Error('subscription position regressed: event is older than the last applied one');
        });
    }
    finish(provider, providerEventId, disposition, detail) {
        return inWriterTransaction(this.conn, async () => {
            const r = await this.conn.query('UPDATE titan.billing_events SET disposition=$3, reason=$4, request_ids=$5::uuid[], processed_at=now() WHERE provider=$1 AND provider_event_id=$2', [provider, providerEventId, disposition, detail.reason || null, [...detail.requestIds]]);
            if (r.rowCount !== 1)
                throw Error('billing event row missing when finishing');
        });
    }
}
export class PostgresBillingLedger {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async withSubscriptionLock(provider, subscriptionId, task) {
        const conn = await this.pool.connect();
        const key = LOCK_KEY(provider, subscriptionId);
        try {
            await conn.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
            try {
                return await task(new PostgresLedgerTx(conn));
            }
            finally {
                await conn.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
            }
        }
        finally {
            conn.release?.();
        }
    }
}
/** Reads through the access-check snapshot (titan_trusted_reader, organisation-scoped by RLS). */
export class PostgresEntitlementReader {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async entitlement(organisationId, applicationId) {
        const rows = await withCentralReadSnapshot(this.pool, organisationId, repo => repo.entitlements(organisationId, applicationId));
        const row = rows[0];
        if (!row)
            return undefined;
        return {
            id: row.id,
            revision: row.revision,
            state: row.status,
            features: [...row.features],
            expiresAt: row.expiresAt ?? null,
        };
    }
}
