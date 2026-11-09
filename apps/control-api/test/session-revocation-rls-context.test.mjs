/** Context wiring for migration 0010 (RLS on titan_session_revocations), with a fake client.
 * readVersion must set the organisation scope inside its own reader transaction, before the SELECT,
 * as a bound parameter. revokeAll is cross-tenant and must not set a scope. No database is used;
 * tests/sql/session_revocation_rls.sql proves the policies on PostgreSQL. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresSessionRevocations} from '../src/session-revocation-pg.mjs';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

/** Fake pool that records every statement and its parameters, per connection. */
function recordingPool({fail = {}, rows = [{generation: '3'}]} = {}) {
  const conns = [];
  return {
    conns,
    connect: async () => {
      const c = {log: [], released: undefined};
      c.query = async (q, v) => {
        c.log.push({q, v});
        for (const [prefix, err] of Object.entries(fail)) if (q.startsWith(prefix)) throw err;
        if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL ROLE)/.test(q)) return {rows: [], rowCount: 0};
        if (q.startsWith("SELECT set_config")) return {rows: [{set_config: v[0]}], rowCount: 1};
        return {rows, rowCount: rows.length};
      };
      c.release = err => { c.released = err ?? 'clean'; };
      conns.push(c);
      return c;
    }
  };
}

test('readVersion sets the organisation scope after SET LOCAL ROLE and before the SELECT', async () => {
  const pool = recordingPool();
  assert.equal(await createPostgresSessionRevocations({pool}).readVersion({applicationId: 'desk', logtoSubject: 'sub1', organisationId: ORG_A}), 3);
  const [c] = pool.conns;
  assert.deepEqual(c.log.map(x => x.q.split('\n')[0].slice(0, 60)), [
    'BEGIN',
    'SET LOCAL ROLE titan_trusted_reader',
    "SELECT set_config('titan.organisation_id', $1, true)",
    'SELECT generation FROM titan.titan_session_revocations WHERE',
    'COMMIT'
  ]);
  assert.deepEqual(c.log[2].v, [ORG_A]);
  assert.equal(c.log[2].q.includes(ORG_A), false, 'scope must be a bound parameter, not interpolated');
  assert.equal(c.released, 'clean');
});

test('readVersion scope follows the organisation of each call, even on a reused connection', async () => {
  const pool = recordingPool();
  const store = createPostgresSessionRevocations({pool});
  await store.readVersion({applicationId: 'desk', logtoSubject: 'sub1', organisationId: ORG_A});
  await store.readVersion({applicationId: 'desk', logtoSubject: 'sub1', organisationId: ORG_B});
  assert.equal(pool.conns.length, 2);
  const scopes = pool.conns.map(c => c.log.find(x => x.q.startsWith('SELECT set_config')).v[0]);
  assert.deepEqual(scopes, [ORG_A, ORG_B]);
});

test('a failed scope set aborts readVersion before any SELECT runs, so no unscoped read happens', async () => {
  const pool = recordingPool({fail: {"SELECT set_config": new Error('scope rejected')}});
  await assert.rejects(createPostgresSessionRevocations({pool}).readVersion({applicationId: 'desk', logtoSubject: 'sub1', organisationId: ORG_A}), /scope rejected/);
  const [c] = pool.conns;
  assert.equal(c.log.some(x => x.q.startsWith('SELECT generation')), false);
  assert.equal(c.log.at(-1).q, 'ROLLBACK');
  assert.equal(c.released, 'clean');
});

test('readVersion rejects an invalid organisation before it takes a connection', async () => {
  const pool = recordingPool();
  await assert.rejects(createPostgresSessionRevocations({pool}).readVersion({applicationId: 'desk', logtoSubject: 'sub1', organisationId: "org'; --"}), /invalid revocation scope/);
  assert.equal(pool.conns.length, 0);
});

test('revokeAll runs as the trusted writer and sets no organisation scope (cross-tenant by design)', async () => {
  const pool = recordingPool({rows: [{generation: '2'}]});
  assert.equal(await createPostgresSessionRevocations({pool}).revokeAll({applicationId: 'field', logtoSubject: 'sub1', organisationId: ORG_B}), 2);
  const [c] = pool.conns;
  assert.deepEqual(c.log.map(x => x.q.split('\n')[0].slice(0, 60)), [
    'BEGIN',
    'SET LOCAL ROLE titan_trusted_writer',
    'INSERT INTO titan.titan_session_revocations (application_id,',
    'COMMIT'
  ]);
  assert.equal(c.log.some(x => x.q.includes('set_config')), false);
  assert.deepEqual(c.log[2].v, ['field', 'sub1', ORG_B]);
});
