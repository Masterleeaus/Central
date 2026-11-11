/** Canonical lookup of Logto identifiers for Central UUIDs (issue #37). Read-only, one transaction per lookup,
 * run as titan_trusted_reader. TrustedProvisioningService uses it so that commands never choose Logto subjects. */
import type { SqlPool } from './postgres.js';
import type { GetCanonicalLogtoId } from './trusted-provisioning.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresCanonicalResolver(pool: SqlPool): GetCanonicalLogtoId {
  return async (type, uuid) => {
    if (type !== 'identity' && type !== 'organisation') throw new TypeError('unknown canonical record type');
    if (typeof uuid !== 'string' || !UUID.test(uuid)) return undefined;
    const conn = await pool.connect(); let begun = false;
    try {
      await conn.query('BEGIN'); begun = true;
      await conn.query('SET LOCAL ROLE titan_trusted_reader');
      await conn.query("SET LOCAL statement_timeout = '5000ms'");
      const result = type === 'identity'
        ? await conn.query('SELECT logto_subject AS value FROM titan.identities WHERE id=$1 LIMIT 2', [uuid])
        : await conn.query('SELECT logto_organisation_id AS value FROM titan.organisations WHERE id=$1 LIMIT 2', [uuid]);
      await conn.query('COMMIT'); begun = false;
      if (result.rows.length > 1) throw new Error('ambiguous canonical record');
      const value = result.rows[0]?.value;
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    } catch (error) {
      if (begun) { try { await conn.query('ROLLBACK'); } catch { /* original error remains authoritative */ } }
      throw error;
    } finally { conn.release?.(); }
  };
}
