/** Runs one task on one pooled connection, inside a transaction that switches to a restricted
 * database role. The login role is NOINHERIT and holds no table privileges, so the role switch is
 * what grants access. SET LOCAL ROLE lasts only until COMMIT or ROLLBACK, so a connection returned
 * to the pool is back on the login role.
 * If the transaction state cannot be confirmed (BEGIN failed, or ROLLBACK failed after an error),
 * the connection is destroyed on release instead of being reused. */
export const DATABASE_ROLES = Object.freeze(['titan_trusted_reader', 'titan_trusted_writer']);

export async function withRoleTransaction(pool, role, task) {
  if (!DATABASE_ROLES.includes(role)) throw new TypeError('invalid database role');
  if (typeof task !== 'function') throw new TypeError('task required');
  if (typeof pool?.connect !== 'function') throw new TypeError('database pool with connect() required');
  const conn = await pool.connect();
  // 'begin': BEGIN not confirmed. 'open': inside the transaction. 'done': ended cleanly.
  // 'unknown': a ROLLBACK failed or BEGIN failed, so the connection must not be reused.
  let phase = 'begin';
  try {
    await conn.query('BEGIN');
    phase = 'open';
    // role is a constant from DATABASE_ROLES; a role name cannot be a bind parameter.
    await conn.query(`SET LOCAL ROLE ${role}`);
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
