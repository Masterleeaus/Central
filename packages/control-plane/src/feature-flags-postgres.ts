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

import { FlagError, type FlagProduct, type FlagEnvironment, type FlagRow, type FlagScope, type FlagSnapshot, type FlagSpec, type FlagStore, type HistoryEntry } from './feature-flags.js';
import type { SqlClient, SqlPool } from './postgres.js';

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_ROLE = 'titan_trusted_reader';
const WRITE_ROLE = 'titan_trusted_writer';
type DatabaseRole = typeof READ_ROLE | typeof WRITE_ROLE;

type ReleasableClient = SqlClient & { release?: (err?: Error) => void };

/** Runs one task inside a transaction that switches to a trusted role. Mirrors role-transaction.mjs. */
async function asRole<T>(pool: SqlPool, role: DatabaseRole, task: (conn: SqlClient) => Promise<T>): Promise<T> {
  const conn = (await pool.connect()) as ReleasableClient;
  // 'begin': BEGIN not confirmed. 'open': inside the transaction. 'done': ended cleanly. 'unknown': cannot be reused.
  let phase: 'begin' | 'open' | 'done' | 'unknown' = 'begin';
  try {
    await conn.query('BEGIN');
    phase = 'open';
    await conn.query(`SET LOCAL ROLE ${role}`);
    await conn.query("SET LOCAL statement_timeout = '5000ms'");
    const result = await task(conn);
    await conn.query('COMMIT');
    phase = 'done';
    return result;
  } catch (error) {
    if (phase === 'open') {
      try { await conn.query('ROLLBACK'); phase = 'done'; } catch { phase = 'unknown'; }
    } else if (phase === 'begin') {
      phase = 'unknown';
    }
    throw error;
  } finally {
    conn.release?.(phase === 'done' ? undefined : new Error('database transaction state unknown'));
  }
}

interface DbFlagRow {
  product: string;
  environment: string;
  flag_key: string;
  organisation_id: string | null;
  flag_type: FlagSpec['type'];
  allowed_values: unknown;
  default_value: unknown;
  owner: string;
  value: unknown;
  rollout_percent: number | string | null;
  cohort: string | null;
  expires_at: Date | string | null;
  revision: number | string;
}

function toFlagRow(r: DbFlagRow): FlagRow {
  return {
    product: r.product as FlagProduct,
    environment: r.environment as FlagEnvironment,
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

function checkScope(scope: FlagScope): void {
  if (scope.organisationId !== null && !UUID_TEXT.test(scope.organisationId)) {
    throw new FlagError('INVALID_REQUEST', 'organisation id must be a UUID or null');
  }
}

/** Creates the FlagStore for a pg-compatible pool. The pool is injected; this module does not import pg. */
export function createPostgresFlagStore(pool: SqlPool): FlagStore {
  if (typeof pool?.connect !== 'function') throw new TypeError('database pool with connect() required');
  return {
    async readScopes(query: FlagScope): Promise<readonly FlagRow[]> {
      checkScope(query);
      const result = await asRole(pool, READ_ROLE, (conn) =>
        conn.query(
          `SELECT product, environment, flag_key, organisation_id, flag_type, allowed_values, default_value,
                  owner, value, rollout_percent, cohort, expires_at, revision
             FROM titan.feature_flags
            WHERE product = $1 AND environment = $2 AND flag_key = $3
              AND (organisation_id IS NULL OR organisation_id = $4::uuid)`,
          [query.product, query.environment, query.flagKey, query.organisationId],
        ),
      );
      return (result.rows as unknown as DbFlagRow[]).map(toFlagRow);
    },

    async readHistory(scope: FlagScope, revision: number) {
      checkScope(scope);
      const result = await asRole(pool, READ_ROLE, (conn) =>
        conn.query(
          `SELECT action, rollback_to_revision, snapshot, actor, reason
             FROM titan.feature_flag_history
            WHERE product = $1 AND environment = $2 AND flag_key = $3
              AND organisation_id IS NOT DISTINCT FROM $4::uuid AND revision = $5`,
          [scope.product, scope.environment, scope.flagKey, scope.organisationId, revision],
        ),
      );
      const row = result.rows[0] as
        | { action: HistoryEntry['action']; rollback_to_revision: number | string | null; snapshot: Record<string, unknown>; actor: string; reason: string }
        | undefined;
      if (!row) return null;
      const s = row.snapshot;
      const snapshot: FlagSnapshot = {
        flagType: s.flag_type as FlagSpec['type'],
        allowed: s.allowed_values,
        defaultValue: s.default_value,
        owner: s.owner as string,
        value: s.value,
        rolloutPercent: (s.rollout_percent as number | null) ?? null,
        cohort: (s.cohort as string | null) ?? null,
        expiresAt: (s.expires_at as string | null) ?? null,
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
        await conn.query(
          "SELECT set_config('titan.change_actor', $1, true), set_config('titan.change_reason', $2, true), set_config('titan.change_rollback_to', $3, true)",
          [entry.actor, entry.reason, entry.rollbackToRevision === null ? '' : String(entry.rollbackToRevision)],
        );
        let rowCount: number | null | undefined;
        try {
          if (expectedRevision === 0) {
            ({ rowCount } = await conn.query(
              `INSERT INTO titan.feature_flags (product, environment, flag_key, organisation_id, flag_type, allowed_values,
                                                default_value, owner, value, rollout_percent, cohort, expires_at, revision)
               VALUES ($1, $2, $3, $4::uuid, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13)`,
              params,
            ));
          } else {
            ({ rowCount } = await conn.query(
              `UPDATE titan.feature_flags
                  SET flag_type = $5, allowed_values = $6::jsonb, default_value = $7::jsonb, owner = $8,
                      value = $9::jsonb, rollout_percent = $10, cohort = $11, expires_at = $12, revision = $13
                WHERE product = $1 AND environment = $2 AND flag_key = $3
                  AND organisation_id IS NOT DISTINCT FROM $4::uuid AND revision = $14`,
              [...params, expectedRevision],
            ));
          }
        } catch (error) {
          const code = (error as { code?: string })?.code;
          // 23505: a concurrent insert won the scope. 40001: serialisation failure from the rollback function.
          if (code === '23505' || code === '40001') throw new FlagError('STALE_REVISION', 'the scope changed while writing');
          throw error;
        }
        if (rowCount !== 1) throw new FlagError('STALE_REVISION', `expected revision ${expectedRevision} no longer matches the scope`);
      });
    },
  };
}
