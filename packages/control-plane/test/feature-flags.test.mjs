import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FlagError,
  createFlagRegistry,
  trustVerifiedContext,
  resolveFlag,
  changeFlag,
  rollbackFlag,
  rolloutBucket,
} from '../dist/feature-flags.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';

const registry = createFlagRegistry([
  { product: 'sorted', key: 'bulk_export', owner: 'sorted-team', spec: { type: 'boolean' }, default: false },
  { product: 'supercharged', key: 'ui_theme', owner: 'desk-team', spec: { type: 'enum', values: ['classic', 'compact'] }, default: 'classic' },
  { product: 'lms', key: 'max_rows', owner: 'lms-team', spec: { type: 'integer', min: 1, max: 500 }, default: 50 },
]);

// In-memory store with the same commit rule as the SQL: the stored revision must equal the expected
// revision, and every commit appends one history entry. Nothing updates or removes history.
function memoryStore({ failReads = false, hang = false } = {}) {
  const current = new Map();
  const history = [];
  const key = (s) => JSON.stringify([s.product, s.environment, s.flagKey, s.organisationId]);
  const store = {
    current,
    history,
    reads: 0,
    commits: 0,
    async readScopes(q) {
      store.reads++;
      if (failReads) throw new Error('connection refused');
      if (hang) return new Promise(() => {});
      return [...current.values()]
        .filter((r) => r.product === q.product && r.environment === q.environment && r.flagKey === q.flagKey
          && (r.organisationId === null || r.organisationId === q.organisationId))
        .map((r) => ({ ...r }));
    },
    async readHistory(scope, revision) {
      const e = history.find((h) => key(h.scope) === key(scope) && h.revision === revision);
      return e ? structuredClone(e) : null;
    },
    async commit({ scope, expectedRevision, next, entry }) {
      const cur = current.get(key(scope));
      const rev = cur ? cur.revision : 0;
      if (rev !== expectedRevision) throw new FlagError('STALE_REVISION', `stored revision ${rev}`);
      store.commits++;
      current.set(key(scope), { ...next });
      history.push(structuredClone(entry));
    },
    seed(row) {
      current.set(key({ product: row.product, environment: row.environment, flagKey: row.flagKey, organisationId: row.organisationId }), {
        revision: 1,
        rolloutPercent: null,
        cohort: null,
        expiresAt: null,
        ...row,
      });
    },
  };
  return store;
}

const base = (over) => ({
  product: 'sorted', environment: 'production', flagKey: 'bulk_export', organisationId: null,
  flagType: 'boolean', allowed: [true, false], defaultValue: false, owner: 'sorted-team',
  value: false, rolloutPercent: null, cohort: null, expiresAt: null, revision: 1, ...over,
});

const NOW = new Date('2030-06-01T00:00:00Z');
const FUTURE = new Date('2030-07-01T00:00:00Z');
const PAST = new Date('2030-05-01T00:00:00Z');
const deps = (store, extra = {}) => ({ registry, store, now: () => NOW, ...extra });
const ctx = (organisationId = ORG_A, cohorts = []) => trustVerifiedContext({ organisationId, cohorts });
const req = (over = {}) => ({ product: 'sorted', environment: 'production', key: 'bulk_export', ...over });

// ---------------------------------------------------------------- registry

test('registry rejects a flag that was never declared', async () => {
  const store = memoryStore();
  await assert.rejects(resolveFlag(deps(store), req({ key: 'not_declared' }), ctx()), (e) => e instanceof FlagError && e.code === 'UNDECLARED_FLAG');
  assert.equal(store.reads, 0, 'an undeclared key never reaches the store');
  assert.throws(() => registry.get('sorted', 'missing'), (e) => e.code === 'UNDECLARED_FLAG');
});

test('registry rejects a declaration whose default is outside its type or allowed values', () => {
  const bad = (decl) => assert.throws(() => createFlagRegistry([decl]), (e) => e.code === 'INVALID_DECLARATION');
  bad({ product: 'sorted', key: 'x', owner: 'o', spec: { type: 'boolean' }, default: 'yes' });
  bad({ product: 'supercharged', key: 'x', owner: 'o', spec: { type: 'enum', values: ['a'] }, default: 'b' });
  bad({ product: 'lms', key: 'x', owner: 'o', spec: { type: 'integer', min: 1, max: 5 }, default: 6 });
  bad({ product: 'lms', key: 'x', owner: 'o', spec: { type: 'integer', min: 1, max: 5 }, default: 1.5 });
  bad({ product: 'lms', key: 'x', owner: '  ', spec: { type: 'integer', min: 1, max: 5 }, default: 2 });
  bad({ product: 'lms', key: 'BadKey', owner: 'o', spec: { type: 'integer', min: 1, max: 5 }, default: 2 });
  bad({ product: 'desk', key: 'x', owner: 'o', spec: { type: 'boolean' }, default: true });
  bad({ product: 'lms', key: 'x', owner: 'o', spec: { type: 'enum', values: ['a', 'a'] }, default: 'a' });
  bad({ product: 'lms', key: 'x', owner: 'o', spec: { type: 'integer', min: 9, max: 1 }, default: 5 });
  assert.throws(() => createFlagRegistry([
    { product: 'lms', key: 'x', owner: 'o', spec: { type: 'boolean' }, default: true },
    { product: 'lms', key: 'x', owner: 'o', spec: { type: 'boolean' }, default: false },
  ]), (e) => e.code === 'INVALID_DECLARATION');
});

// ---------------------------------------------------------------- precedence

test('with no stored rows the declared default is served', async () => {
  const r = await resolveFlag(deps(memoryStore()), req(), ctx());
  assert.deepEqual([r.value, r.source], [false, 'default']);
});

test('a global row serves its value to everyone when it has no targeting', async () => {
  const store = memoryStore();
  store.seed(base({ value: true }));
  const r = await resolveFlag(deps(store), req(), ctx(ORG_B));
  assert.deepEqual([r.value, r.source, r.revision], [true, 'global', 1]);
});

test('precedence: organisation override beats cohort, which beats rollout, which beats the default', async () => {
  const store = memoryStore();
  store.seed(base({ value: true, cohort: 'pilot-a' }));
  store.seed(base({ organisationId: ORG_A, value: false, expiresAt: FUTURE, revision: 4 }));
  // Override wins for ORG_A even though ORG_A is in the cohort.
  let r = await resolveFlag(deps(store), req(), ctx(ORG_A, ['pilot-a']));
  assert.deepEqual([r.value, r.source], [false, 'override']);
  // ORG_B is in the cohort, so the cohort value applies.
  r = await resolveFlag(deps(store), req(), ctx(ORG_B, ['pilot-a']));
  assert.deepEqual([r.value, r.source], [true, 'cohort']);
  // ORG_B outside the cohort: the cohort rule does not apply and the default does.
  r = await resolveFlag(deps(store), req(), ctx(ORG_B, []));
  assert.deepEqual([r.value, r.source], [false, 'default']);
});

test('a rollout row serves its value only to organisations inside the bucket', async () => {
  const store = memoryStore();
  store.seed(base({ value: true, rolloutPercent: 50 }));
  const inside = [];
  const outside = [];
  for (let i = 0; i < 200; i++) {
    const org = `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
    const r = await resolveFlag(deps(store), req(), ctx(org));
    (rolloutBucket(org, 'bulk_export') < 50 ? inside : outside).push(r);
  }
  assert.ok(inside.every((r) => r.source === 'rollout' && r.value === true));
  assert.ok(outside.every((r) => r.source === 'default' && r.value === false));
  assert.ok(inside.length > 60 && inside.length < 140, `about half the orgs are in: ${inside.length}`);
});

test('a rollout with no organisation in the verified context never applies it', async () => {
  const store = memoryStore();
  store.seed(base({ value: true, rolloutPercent: 100 }));
  const r = await resolveFlag(deps(store), req(), ctx(null));
  assert.deepEqual([r.value, r.source], [false, 'default']);
});

test('environments are separate: a production override does not reach staging', async () => {
  const store = memoryStore();
  store.seed(base({ organisationId: ORG_A, value: true, expiresAt: FUTURE }));
  const prod = await resolveFlag(deps(store), req({ environment: 'production' }), ctx(ORG_A));
  const staging = await resolveFlag(deps(store), req({ environment: 'staging' }), ctx(ORG_A));
  assert.deepEqual([prod.value, prod.source], [true, 'override']);
  assert.deepEqual([staging.value, staging.source], [false, 'default']);
});

test('an override is applied only to its own organisation', async () => {
  const store = memoryStore();
  store.seed(base({ organisationId: ORG_A, value: true, expiresAt: FUTURE }));
  const r = await resolveFlag(deps(store), req(), ctx(ORG_B));
  assert.deepEqual([r.value, r.source], [false, 'default']);
});

// ---------------------------------------------------------------- expiry

test('an expired organisation override falls back to the next layer, then the default', async () => {
  const store = memoryStore();
  store.seed(base({ organisationId: ORG_A, value: true, expiresAt: PAST }));
  let r = await resolveFlag(deps(store), req(), ctx(ORG_A));
  assert.deepEqual([r.value, r.source], [false, 'default']);

  store.seed(base({ value: true }));
  r = await resolveFlag(deps(store), req(), ctx(ORG_A));
  assert.deepEqual([r.value, r.source], [true, 'global'], 'an expired override does not hide a live global row');
});

test('an expired global row is ignored and the default applies', async () => {
  const store = memoryStore();
  store.seed(base({ value: true, expiresAt: PAST }));
  const r = await resolveFlag(deps(store), req(), ctx(ORG_A));
  assert.deepEqual([r.value, r.source], [false, 'default']);
});

// ---------------------------------------------------------------- deterministic bucketing

test('bucketing is a fixed hash of organisation and flag key, not random', () => {
  const expected = createHash('sha256').update(`${ORG_A}\u0000bulk_export`).digest().readUInt32BE(0) % 100;
  assert.equal(rolloutBucket(ORG_A, 'bulk_export'), expected);
  for (let i = 0; i < 50; i++) assert.equal(rolloutBucket(ORG_A, 'bulk_export'), expected);
  assert.notEqual(rolloutBucket(ORG_A, 'bulk_export'), undefined);
  assert.ok(Number.isInteger(rolloutBucket(ORG_B, 'max_rows')) && rolloutBucket(ORG_B, 'max_rows') < 100);
});

test('bucketing is monotonic: raising the percentage only adds organisations', async () => {
  const orgs = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`);
  const at = (pct) => orgs.filter((o) => rolloutBucket(o, 'bulk_export') < pct);
  const ten = new Set(at(10));
  const fifty = new Set(at(50));
  assert.ok([...ten].every((o) => fifty.has(o)));
  assert.ok(fifty.size > ten.size);
});

test('bucketing spreads organisations across the range', () => {
  const buckets = new Set();
  for (let i = 1; i <= 500; i++) {
    buckets.add(rolloutBucket(`00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`, 'ui_theme'));
  }
  assert.ok(buckets.size > 80, `distinct buckets: ${buckets.size}`);
});

// ---------------------------------------------------------------- tenant targeting is server-side

test('the resolver refuses a client-supplied organisation or tenant field', async () => {
  const store = memoryStore();
  store.seed(base({ organisationId: ORG_B, value: true, expiresAt: FUTURE }));
  for (const field of ['organisationId', 'organisation_id', 'tenant', 'cohorts']) {
    await assert.rejects(
      resolveFlag(deps(store), { ...req(), [field]: ORG_B }, ctx(ORG_A)),
      (e) => e instanceof FlagError && e.code === 'FORBIDDEN_FIELD',
      field,
    );
  }
});

test('the resolver refuses a context that did not come from trustVerifiedContext', async () => {
  await assert.rejects(
    resolveFlag(deps(memoryStore()), req(), { organisationId: ORG_A, cohorts: [] }),
    (e) => e.code === 'INVALID_REQUEST',
  );
});

test('trustVerifiedContext rejects a malformed organisation id and a malformed cohort', () => {
  assert.throws(() => trustVerifiedContext({ organisationId: 'org-a' }), (e) => e.code === 'INVALID_REQUEST');
  assert.throws(() => trustVerifiedContext({ organisationId: ORG_A, cohorts: ['Bad Cohort'] }), (e) => e.code === 'INVALID_REQUEST');
});

// ---------------------------------------------------------------- store failures fall back safely

test('store unavailable: the declared default is served with a reason', async () => {
  const r = await resolveFlag(deps(memoryStore({ failReads: true })), req(), ctx());
  assert.deepEqual([r.value, r.source, r.reason], [false, 'fallback', 'store-unavailable']);
});

test('store that never answers: the read times out and the declared default is served', async () => {
  const started = Date.now();
  const r = await resolveFlag(deps(memoryStore({ hang: true }), { storeTimeoutMs: 20 }), req(), ctx());
  assert.deepEqual([r.value, r.source, r.reason], [false, 'fallback', 'store-unavailable']);
  assert.ok(Date.now() - started < 2000);
});

test('an invalid stored value never reaches the caller: the declared default is served', async () => {
  const store = memoryStore();
  store.seed(base({ value: 'yes' }));
  const r = await resolveFlag(deps(store), req(), ctx());
  assert.deepEqual([r.value, r.source, r.reason], [false, 'fallback', 'invalid-configuration']);
});

test('a stored row whose type or default disagrees with the declaration is invalid configuration', async () => {
  const cases = [
    base({ flagType: 'enum', allowed: ['a', 'b'], value: true }),
    base({ defaultValue: true, value: true }),
    base({ owner: 'someone-else', value: true }),
  ];
  for (const row of cases) {
    const store = memoryStore();
    store.seed(row);
    const r = await resolveFlag(deps(store), req(), ctx());
    assert.equal(r.reason, 'invalid-configuration');
    assert.equal(r.value, false);
  }
});

test('a row for another organisation returned by the store is treated as invalid configuration', async () => {
  const store = memoryStore();
  store.seed(base({ organisationId: ORG_B, value: true, expiresAt: FUTURE }));
  const real = store.readScopes.bind(store);
  store.readScopes = async (q) => [...(await real(q)), ...[...store.current.values()].filter((r) => r.organisationId === ORG_B)];
  const r = await resolveFlag(deps(store), req(), ctx(ORG_A));
  assert.deepEqual([r.value, r.source, r.reason], [false, 'fallback', 'invalid-configuration']);
});

// ---------------------------------------------------------------- change: revisions, audit, validation

test('a change at the current expected revision commits, records actor and reason, and bumps the revision', async () => {
  const store = memoryStore();
  store.seed(base({ value: false, revision: 2 }));
  const revision = await changeFlag(deps(store), {
    product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null,
    expectedRevision: 2, value: true, actor: 'ops@example.test', reason: 'enable for pilot cohort',
  });
  assert.equal(revision, 3);
  assert.equal(store.current.get(JSON.stringify(['sorted', 'production', 'bulk_export', null])).value, true);
  const entry = store.history.at(-1);
  assert.deepEqual([entry.action, entry.revision, entry.actor, entry.reason], ['set', 3, 'ops@example.test', 'enable for pilot cohort']);
  assert.equal(entry.snapshot.value, true);
});

test('a stale expected revision is rejected and nothing is written', async () => {
  const store = memoryStore();
  store.seed(base({ value: false, revision: 3 }));
  await assert.rejects(
    changeFlag(deps(store), {
      product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null,
      expectedRevision: 2, value: true, actor: 'ops', reason: 'stale write',
    }),
    (e) => e instanceof FlagError && e.code === 'STALE_REVISION',
  );
  assert.equal(store.commits, 0);
  assert.equal(store.history.length, 0);
  assert.equal(store.current.get(JSON.stringify(['sorted', 'production', 'bulk_export', null])).value, false);
});

test('two writers holding the same revision: the second is rejected at commit', async () => {
  const store = memoryStore();
  store.seed(base({ value: false, revision: 1 }));
  const change = { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null, expectedRevision: 1, actor: 'a', reason: 'race' };
  await changeFlag(deps(store), { ...change, value: true });
  await assert.rejects(changeFlag(deps(store), { ...change, value: false }), (e) => e.code === 'STALE_REVISION');
  assert.equal(store.history.length, 1);
});

test('a first write uses expected revision 0 and is recorded as create', async () => {
  const store = memoryStore();
  const revision = await changeFlag(deps(store), {
    product: 'lms', environment: 'staging', key: 'max_rows', organisationId: null,
    expectedRevision: 0, value: 120, actor: 'lms-ops', reason: 'raise staging cap',
  });
  assert.equal(revision, 1);
  assert.equal(store.history[0].action, 'create');
  await assert.rejects(
    changeFlag(deps(store), { product: 'lms', environment: 'staging', key: 'max_rows', organisationId: null, expectedRevision: 0, value: 130, actor: 'x', reason: 'again' }),
    (e) => e.code === 'STALE_REVISION',
  );
});

test('a change is refused before any store access when the value, actor, reason or targeting is invalid', async () => {
  const store = memoryStore();
  const common = { product: 'supercharged', environment: 'staging', key: 'ui_theme', organisationId: null, expectedRevision: 0, actor: 'desk', reason: 'r' };
  const cases = [
    [{ value: 'dark' }, 'INVALID_VALUE'],
    [{ value: 'classic', actor: '  ' }, 'INVALID_REQUEST'],
    [{ value: 'classic', reason: '' }, 'INVALID_REQUEST'],
    [{ value: 'classic', rolloutPercent: 101 }, 'INVALID_TARGETING'],
    [{ value: 'classic', rolloutPercent: 10, cohort: 'pilot' }, 'INVALID_TARGETING'],
    [{ value: 'classic', organisationId: ORG_A }, 'INVALID_TARGETING'],
    [{ value: 'classic', organisationId: ORG_A, expiresAt: PAST }, 'INVALID_TARGETING'],
    [{ value: 'classic', organisationId: 'not-a-uuid' }, 'INVALID_REQUEST'],
  ];
  for (const [over, code] of cases) {
    await assert.rejects(changeFlag(deps(store), { ...common, ...over }), (e) => e.code === code, JSON.stringify(over));
  }
  assert.equal(store.reads, 0);
  assert.equal(store.commits, 0);
});

test('a change to an undeclared flag is refused', async () => {
  await assert.rejects(
    changeFlag(deps(memoryStore()), { product: 'lms', environment: 'staging', key: 'free_form', organisationId: null, expectedRevision: 0, value: 1, actor: 'x', reason: 'y' }),
    (e) => e.code === 'UNDECLARED_FLAG',
  );
});

test('an organisation override requires an expiry, and a valid one commits', async () => {
  const store = memoryStore();
  const common = { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: ORG_A, expectedRevision: 0, value: true, actor: 'ops', reason: 'pilot' };
  await assert.rejects(changeFlag(deps(store), common), (e) => e.code === 'INVALID_TARGETING');
  assert.equal(await changeFlag(deps(store), { ...common, expiresAt: FUTURE }), 1);
});

test('the history is append-only: a rollback adds an entry and never edits one', async () => {
  const store = memoryStore();
  await changeFlag(deps(store), { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null, expectedRevision: 0, value: false, actor: 'ops', reason: 'create' });
  await changeFlag(deps(store), { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null, expectedRevision: 1, value: true, actor: 'ops', reason: 'on' });
  const before = structuredClone(store.history);
  await rollbackFlag(deps(store), { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null, expectedRevision: 2, toRevision: 1, actor: 'ops', reason: 'back off' });
  assert.equal(store.history.length, before.length + 1);
  assert.deepEqual(store.history.slice(0, before.length), before);
});

// ---------------------------------------------------------------- rollback

test('rollback restores a previous value as a new revision, recorded as rollback with actor and reason', async () => {
  const store = memoryStore();
  await changeFlag(deps(store), { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null, expectedRevision: 0, value: false, actor: 'ops', reason: 'create' });
  await changeFlag(deps(store), { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null, expectedRevision: 1, value: true, actor: 'ops', reason: 'enable' });
  const revision = await rollbackFlag(deps(store), {
    product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null,
    expectedRevision: 2, toRevision: 1, actor: 'ops-2', reason: 'incident: revert',
  });
  assert.equal(revision, 3);
  assert.equal(store.current.get(JSON.stringify(['sorted', 'production', 'bulk_export', null])).value, false);
  const entry = store.history.at(-1);
  assert.deepEqual([entry.action, entry.rollbackToRevision, entry.actor, entry.reason], ['rollback', 1, 'ops-2', 'incident: revert']);
  const r = await resolveFlag(deps(store), req(), ctx(ORG_A));
  assert.equal(r.value, false);
});

test('rollback refuses an unknown revision, a stale expected revision, and a snapshot whose expiry has passed', async () => {
  const store = memoryStore();
  store.seed(base({ organisationId: ORG_A, value: true, expiresAt: FUTURE, revision: 1 }));
  const common = { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: ORG_A, actor: 'ops', reason: 'r' };
  // Revision 2 is a real history entry: the override is re-set with a later expiry.
  await changeFlag(deps(store), { ...common, expectedRevision: 1, value: false, expiresAt: new Date('2030-06-02T00:00:00Z') });
  await assert.rejects(rollbackFlag(deps(store), { ...common, expectedRevision: 2, toRevision: 9 }), (e) => e.code === 'UNKNOWN_REVISION');
  await assert.rejects(rollbackFlag(deps(store), { ...common, expectedRevision: 5, toRevision: 2 }), (e) => e.code === 'STALE_REVISION');

  // The recorded snapshot of revision 2 is now past its expiry: it must not be restored.
  store.history[0].snapshot.expiresAt = PAST.toISOString();
  await assert.rejects(rollbackFlag(deps(store), { ...common, expectedRevision: 2, toRevision: 2 }), (e) => e.code === 'ROLLBACK_REFUSED');
  assert.equal(store.commits, 1, 'only the re-set committed');
});

test('a store that is down during a change is not silently treated as success', async () => {
  const store = memoryStore({ failReads: true });
  await assert.rejects(
    changeFlag(deps(store), { product: 'lms', environment: 'staging', key: 'max_rows', organisationId: null, expectedRevision: 0, value: 10, actor: 'x', reason: 'y' }),
    /connection refused/,
  );
  assert.equal(store.commits, 0);
});
