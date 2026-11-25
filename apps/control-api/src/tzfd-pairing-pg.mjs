/** PostgreSQL store for the Front Desk pairing route (migration 0031, contract tzfd-pair/1).
 * One call runs one transaction under the narrow role titan_tzfd_pair. It executes only the
 * SECURITY DEFINER function titan.pair_tzfd_site, which consumes the code and binds the secret atomically.
 * Resolves null when the code is refused. Rejects on any database error, after a rollback, so the code stays unused.
 * The pool's login role must be a member of titan_tzfd_pair (granted at deployment, as for the other narrow roles). */
const SITE = /^site-[a-f0-9]{24}$/;
const HEX64 = /^[a-f0-9]{64}$/;

export function createPostgresTzfdPairingStore({ pool, clock = () => Date.now() } = {}) {
  if (typeof pool?.connect !== 'function' || typeof clock !== 'function') {
    throw new TypeError('trusted database pairing store required');
  }
  return {
    async pair({ codeDigest, siteId, secret } = {}) {
      if (typeof codeDigest !== 'string' || !HEX64.test(codeDigest) || typeof siteId !== 'string' || !SITE.test(siteId)
        || typeof secret !== 'string' || !HEX64.test(secret)) {
        return null;
      }
      const client = await pool.connect();
      let open = false;
      try {
        await client.query('BEGIN');
        open = true;
        await client.query('SET LOCAL ROLE titan_tzfd_pair');
        await client.query("SET LOCAL statement_timeout = '5000ms'");
        const result = await client.query(
          'SELECT titan.pair_tzfd_site($1::char(64),$2::text,$3::char(64))::text AS company_uuid',
          [codeDigest, siteId, secret],
        );
        if (result.rows?.length !== 1) throw Error('pairing function contract unavailable');
        await client.query('COMMIT');
        open = false;
        const companyUuid = result.rows[0].company_uuid;
        return typeof companyUuid === 'string' ? { companyUuid } : null;
      } catch (error) {
        if (open) {
          try { await client.query('ROLLBACK'); } catch { /* the original error is what matters */ }
        }
        throw error;
      } finally {
        client.release?.();
      }
    },
  };
}
