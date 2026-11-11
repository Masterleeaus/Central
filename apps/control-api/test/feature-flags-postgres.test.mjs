// Feature-flag adapter against a real PostgreSQL server (issue #38, migration 0013).
// Skipped unless TITAN_FLAG_TEST_DATABASE_URL is set. The URL must log in as titan_central_app, a
// NOINHERIT login role that is a member of titan_trusted_reader and titan_trusted_writer, on a database
// where migrations 0001 to 0009 and 0013 are applied. Each run uses its own flag keys and organisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  createFlagRegistry, createPostgresFlagStore, changeFlag, rollbackFlag, resolveFlag, trustVerifiedContext, FlagError,
} from '../../../packages/control-plane/dist/index.js';
import { createConfigReadHandler } from '../src/config-read.mjs';

const DB_URL = process.env.TITAN_FLAG_TEST_DATABASE_URL;
const skip = DB_URL ? false : 'set TITAN_FLAG_TEST_DATABASE_URL to run against PostgreSQL 16';
const RUN = Date.now().toString(36);
const BOOL = `it_${RUN}_bool`;
const INT = `it_${RUN}_int`;
const PRODUCT = 'lms';
const ENVIRONMENT = 'development';
const ACTOR = 'operator-subject-it';
const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const FUTURE = new Date(Date.now() + 86_400_000);
const LATER = new Date(Date.now() + 2 * 86_400_000);

const registry = createFlagRegistry([
  { product: PRODUCT, key: BOOL, owner: 'lms-team', spec: { type: 'boolean' }, default: false },
  { product: PRODUCT, key: INT, owner: 'lms-team', spec: { type: 'integer', min: 1, max: 500 }, default: 50 },
]);
const scope = (key, organisationId = null) => ({ product: PRODUCT, environment: ENVIRONMENT, flagKey: key, organisationId });

let pool;
let store;

/** Runs one task as titan_trusted_writer inside a transaction (test setup only). */
async function asWriter(task) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE titan_trusted_writer');
    const r = await task(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

test.before(async () => {
  if (skip) return;
  const pg = (await import('pg')).default;
  pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
  store = createPostgresFlagStore(pool);
  await asWriter(c => c.query(
    "INSERT INTO titan.organisations (id, logto_organisation_id, state) VALUES ($1, $2, 'active'), ($3, $4, 'active')",
    [ORG, `it-${RUN}-a`, OTHER_ORG, `it-${RUN}-b`],
  ));
});
test.after(async () => { if (pool) await pool.end(); });

test('login role has no direct privilege on the flag tables', { skip }, async () => {
  await assert.rejects(pool.query('SELECT 1 FROM titan.feature_flags LIMIT 1'), err => err.code === '42501');
  await assert.rejects(pool.query('SELECT 1 FROM titan.feature_flag_history LIMIT 1'), err => err.code === '42501');
});

test('create writes revision 1 and history records the actor and reason', { skip }, async () => {
  const rev = await changeFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL, organisationId: null, expectedRevision: 0, value: false, actor: ACTOR, reason: 'initial' });
  assert.equal(rev, 1);
  const h = await store.readHistory(scope(BOOL), 1);
  assert.equal(h.action, 'create');
  assert.equal(h.actor, ACTOR);
  assert.equal(h.reason, 'initial');
});

test('set at the current revision advances; a stale revision is refused and writes nothing', { skip }, async () => {
  const rev = await changeFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL, organisationId: null, expectedRevision: 1, value: true, actor: ACTOR, reason: 'enable' });
  assert.equal(rev, 2);
  await assert.rejects(
    changeFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL, organisationId: null, expectedRevision: 1, value: false, actor: ACTOR, reason: 'stale' }),
    err => err instanceof FlagError && err.code === 'STALE_REVISION',
  );
  assert.equal(await store.readHistory(scope(BOOL), 3), null, 'no revision 3 was written');
  const resolved = await resolveFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL }, trustVerifiedContext({ organisationId: null }));
  assert.deepEqual([resolved.value, resolved.source, resolved.revision], [true, 'global', 2]);
});

test('two concurrent creates: exactly one wins and the other is STALE_REVISION', { skip }, async () => {
  const attempt = value => changeFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: INT, organisationId: null, expectedRevision: 0, value, actor: ACTOR, reason: 'race' });
  const results = await Promise.allSettled([attempt(10), attempt(20)]);
  const won = results.filter(r => r.status === 'fulfilled');
  const lost = results.filter(r => r.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.code, 'STALE_REVISION');
});

test('organisation override applies to its organisation only and is ignored after expiry', { skip }, async () => {
  await changeFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL, organisationId: ORG, expectedRevision: 0, value: false, expiresAt: FUTURE, actor: ACTOR, reason: 'pilot off for org' });
  const inOrg = await resolveFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL }, trustVerifiedContext({ organisationId: ORG }));
  assert.deepEqual([inOrg.value, inOrg.source], [false, 'override']);
  const other = await resolveFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL }, trustVerifiedContext({ organisationId: OTHER_ORG }));
  assert.deepEqual([other.value, other.source], [true, 'global']);
  const expired = await resolveFlag({ registry, store, now: () => LATER }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL }, trustVerifiedContext({ organisationId: ORG }));
  assert.deepEqual([expired.value, expired.source], [true, 'global'], 'an expired override does not apply');
});

test('rollback restores a history revision as a new revision recorded with action rollback', { skip }, async () => {
  const rev = await rollbackFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL, organisationId: null, expectedRevision: 2, toRevision: 1, actor: ACTOR, reason: 'undo enable' });
  assert.equal(rev, 3);
  const h = await store.readHistory(scope(BOOL), 3);
  assert.equal(h.action, 'rollback');
  assert.equal(h.rollbackToRevision, 1);
  assert.equal(h.snapshot.value, false);
  await assert.rejects(
    rollbackFlag({ registry, store }, { product: PRODUCT, environment: ENVIRONMENT, key: BOOL, organisationId: null, expectedRevision: 2, toRevision: 1, actor: ACTOR, reason: 'stale' }),
    err => err instanceof FlagError && err.code === 'STALE_REVISION',
  );
});

test('the trusted writer cannot change or delete history', { skip }, async () => {
  await assert.rejects(asWriter(c => c.query("UPDATE titan.feature_flag_history SET reason = 'edited' WHERE flag_key = $1", [BOOL])), err => err.code === '42501');
  await assert.rejects(asWriter(c => c.query('DELETE FROM titan.feature_flag_history WHERE flag_key = $1', [BOOL])), err => err.code === '42501');
});

test('read endpoint serves the stored override for the token organisation through PostgreSQL', { skip }, async () => {
  const handler = createConfigReadHandler({
    verifyServiceToken: async token => {
      if (token !== 'tok-it') throw new Error('bad token');
      return { product: PRODUCT, logtoSubject: 'svc-it', context: trustVerifiedContext({ organisationId: ORG }) };
    },
    registry, store,
  });
  const server = createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/internal/v1/config/${ENVIRONMENT}/${BOOL}`;
    const res = await fetch(url, { headers: { authorization: 'Bearer tok-it' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'override');
    assert.equal(body.value, false);
    assert.equal(body.key, BOOL);
    const withQuery = await fetch(`${url}?organisation_id=${OTHER_ORG}`, { headers: { authorization: 'Bearer tok-it' } });
    assert.equal(withQuery.status, 400, 'a client-named organisation is refused');
  } finally { await new Promise(r => server.close(r)); }
});

test('an unreachable database resolves to the declared default with source fallback', { skip }, async () => {
  const down = createPostgresFlagStore({ connect: async () => { throw new Error('connect ECONNREFUSED'); } });
  const resolved = await resolveFlag({ registry, store: down }, { product: PRODUCT, environment: ENVIRONMENT, key: INT }, trustVerifiedContext({ organisationId: ORG }));
  assert.deepEqual([resolved.value, resolved.source, resolved.revision], [50, 'fallback', null]);
});
