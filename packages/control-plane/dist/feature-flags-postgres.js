// PostgreSQL adapter for the feature-flag store port (issue #38, migration 0013).
//
// Reads run as titan_trusted_reader and writes run as titan_trusted_writer, the only roles that
// hold grants on titan.feature_flags and titan.feature_flag_history (migration 0013). The login role
// holds no table privileges and reaches the tables only through SET LOCAL ROLE.
//
// The database is authoritative for history: the audit trigger writes the titan.feature_flag_history
// row in the same transaction as the change, using titan.change_actor and titan.change_reason set
// here. The HistoryEntry passed to commit() is therefore not written by this adapter; it only
// supplies the actor, reason and rollback source for those settings.
//
// Stale or concurrent writers are reported as FlagError('STALE_REVISION'): an UPDATE that matches no
// row, or a unique violation on the scope when two inserts race.
import { FlagError } from './feature-flags.js';
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_ROLE = 'titan_trusted_reader';
const WRITE_ROLE = 'titan_trusted_writer';
/** Runs one task inside a transaction that switches to a trusted role. Mirrors role-transaction.mjs. */
async function asRole(pool, role, task) {
    const conn = (await pool.connect());
    // 'begin': BEGIN not confirmed. 'open': inside the transaction. 'done': ended cleanly. 'unknown': cannot be reused.
    let phase = 'begin';
    try {
        await conn.query('BEGIN');
        phase = 'open';
        await conn.query(`SET LOCAL ROLE ${role}`);
        await conn.query("SET LOCAL statement_timeout = '5000ms'");
        const result = await task(conn);
        await conn.query('COMMIT');
        phase = 'done';
        return result;
    }
    catch (error) {
        if (phase === 'open') {
            try {
                await conn.query('ROLLBACK');
                phase = 'done';
            }
            catch {
                phase = 'unknown';
            }
        }
        else if (phase === 'begin') {
            phase = 'unknown';
        }
        throw error;
    }
    finally {
        conn.release?.(phase === 'done' ? undefined : new Error('database transaction state unknown'));
    }
}
function toFlagRow(r) {
    return {
        product: r.product,
        environment: r.environment,
        flagKey: r.flag_key,
        organisationId: r.organisation_id ?? null,
        flagType: r.flag_type,
        allowed: r.allowed_values,
        defaultValue: r.default_value,
        owner: r.owner,
        value: r.value,
        rolloutPercent: r.rollout_percent === null ? null : Number(r.rollout_percent),
        cohort: r.cohort ?? null,
        expiresAt: r.expires_at === null ? null : new Date(r.expires_at),
        revision: Number(r.revision),
    };
}
function checkScope(scope) {
    if (scope.organisationId !== null && !UUID_TEXT.test(scope.organisationId)) {
        throw new FlagError('INVALID_REQUEST', 'organisation id must be a UUID or null');
    }
}
/** Creates the FlagStore for a pg-compatible pool. The pool is injected; this module does not import pg. */
export function createPostgresFlagStore(pool) {
    if (typeof pool?.connect !== 'function')
        throw new TypeError('database pool with connect() required');
    return {
        async readScopes(query) {
            checkScope(query);
            const result = await asRole(pool, READ_ROLE, (conn) => conn.query(`SELECT product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value,
                  owner, value, rollout_percent, cohort, expires_at, revision
             FROM titan.feature_flags
            WHERE product = $1 AND environment = $2 AND flag_key = $3
              AND (organisation_id IS NULL OR organisation_id = $4::uuid)`, [query.product, query.environment, query.flagKey, query.organisationId]));
            return result.rows.map(toFlagRow);
        },
        async readHistory(scope, revision) {
            checkScope(scope);
            const result = await asRole(pool, READ_ROLE, (conn) => conn.query(`SELECT action, rollback_to_revision, snapshot, actor, reason
             FROM titan.feature_flag_history
            WHERE product = $1 AND environment = $2 AND flag_key = $3
              AND organisation_id IS NOT DISTINCT FROM $4::uuid AND revision = $5`, [scope.product, scope.environment, scope.flagKey, scope.organisationId, revision]));
            const row = result.rows[0];
            if (!row)
                return null;
            const s = row.snapshot;
            const snapshot = {
                flagType: s.flag_type,
                allowed: s.allowed_values,
                defaultValue: s.default_value,
                owner: s.owner,
                value: s.value,
                rolloutPercent: s.rollout_percent ?? null,
                cohort: s.cohort ?? null,
                expiresAt: s.expires_at ?? null,
            };
            return {
                scope,
                revision,
                action: row.action,
                rollbackToRevision: row.rollback_to_revision === null ? null : Number(row.rollback_to_revision),
                snapshot,
                actor: row.actor,
                reason: row.reason,
            };
        },
        async commit({ scope, expectedRevision, next, entry }) {
            checkScope(scope);
            const params = [
                next.product, next.environment, next.flagKey, next.organisationId, next.flagType,
                JSON.stringify(next.allowed), JSON.stringify(next.defaultValue), next.owner, JSON.stringify(next.value),
                next.rolloutPercent, next.cohort, next.expiresAt, next.revision,
            ];
            await asRole(pool, WRITE_ROLE, async (conn) => {
                await conn.query("SELECT set_config('titan.change_actor', $1, true), set_config('titan.change_reason', $2, true), set_config('titan.change_rollback_to', $3, true)", [entry.actor, entry.reason, entry.rollbackToRevision === null ? '' : String(entry.rollbackToRevision)]);
                let rowCount;
                try {
                    if (expectedRevision === 0) {
                        ({ rowCount } = await conn.query(`INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values,
                                                default_value, owner, value, rollout_percent, cohort, expires_at, revision)
               VALUES ($1, $2, $3, $4::uuid, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13)`, params));
                    }
                    else {
                        ({ rowCount } = await conn.query(`UPDATE titan.feature_flags
                  SET flag_type = $5, allowed_values = $6::jsonb, default_value = $7::jsonb, owner = $8,
                      value = $9::jsonb, rollout_percent = $10, cohort = $11, expires_at = $12, revision = $13
                WHERE product = $1 AND environment = $2 AND flag_key = $3
                  AND organisation_id IS NOT DISTINCT FROM $4::uuid AND revision = $14`, [...params, expectedRevision]));
                    }
                }
                catch (error) {
                    const code = error?.code;
                    // 23505: a concurrent insert won the scope. 40001: serialisation failure from the rollback function.
                    if (code === '23505' || code === '40001')
                        throw new FlagError('STALE_REVISION', 'the scope changed while writing');
                    throw error;
                }
                if (rowCount !== 1)
                    throw new FlagError('STALE_REVISION', `expected revision ${expectedRevision} no longer matches the scope`);
            });
        },
    };
}
