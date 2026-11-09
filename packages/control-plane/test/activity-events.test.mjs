import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareActivityEvent, recordActivity, recordActivityInOwnTransaction, queryActivity } from '../dist/activity-events.js';
import { CentralProvisioner } from '../dist/provisioning.js';

const ORG = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const REQ = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const base = {
 organisationId: ORG, actorKind: 'subject', actorId: 'usr_admin', action: 'membership.update',
 targetType: 'membership', targetId: ID, sourceProduct: 'central', outcome: 'success', correlationId: REQ,
};

/** Scripted SQL client. handler returns a result for each statement; calls record every statement. */
function scripted(handler = () => ({ rows: [], rowCount: 1 })) {
 const calls = [];
 let released = 0;
 const conn = { async query(q, p) { calls.push([q, p]); return handler(q, p); }, release() { released++; } };
 return { calls, get released() { return released; }, pool: { async connect() { return conn; } } };
}
const insertCount = (calls) => calls.filter(([q]) => q.includes('INSERT INTO titan.activity_events')).length;

test('valid event is prepared with stripped personal keys reported by name', () => {
 const e = prepareActivityEvent({ ...base, detail: { role: 'manager', email: 'x' } });
 assert.match(e.eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.deepEqual(e.detail, { role: 'manager' });
 assert.deepEqual(e.strippedDetailKeys, ['email']);
});

test('invalid events are refused before any statement runs', () => {
 const bad = [
  { organisationId: 'not-a-uuid' },
  { actorKind: 'robot' },
  { actorId: 'jo@example.com' },
  { action: 'Membership Update' },
  { action: 'membership' },
  { targetType: 'Membership Table' },
  { targetId: 'Qz8fK2mP9xL4vB7nR1tY6wH3cJ5dG0sA' },
  { sourceProduct: 'billing' },
  { outcome: 'maybe' },
  { correlationId: 'short' },
  { eventId: 'nope' },
  { occurredAt: new Date('x') },
  { detail: { password: 'hunter2' } },
  { detail: { note: 'Bearer abcdefgh12345678' } },
 ];
 for (const patch of bad) {
  assert.throws(() => prepareActivityEvent({ ...base, ...patch }), Error, JSON.stringify(patch));
 }
});

test('recordActivity inserts on the caller connection with parameters and returns the client-generated id', async () => {
 const s = scripted();
 const id = await recordActivity({ query: async (q, p) => s.calls.push([q, p]) }, { ...base, detail: { role: 'manager' } });
 assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 const [sql, params] = s.calls[0];
 assert.doesNotMatch(sql, /RETURNING/, 'no RETURNING: a writer INSERT ... RETURNING is blocked by the scoped SELECT policy');
 assert.equal(params[0], id);
 assert.equal(params[2], ORG);
 assert.equal(params[11], '{"role":"manager"}');
 assert.equal(params[10], REQ);
 assert.equal(s.released, 0, 'caller owns the connection');
});
test('an explicit event id is used as given', async () => {
 const s = scripted();
 const id = await recordActivity({ query: async (q, p) => s.calls.push([q, p]) }, { ...base, eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
 assert.equal(id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

test('a refused event writes nothing on the caller connection', async () => {
 const s = scripted();
 await assert.rejects(recordActivity({ query: async (q, p) => s.calls.push([q, p]) }, { ...base, detail: { token: 'x' } }), /names a credential/);
 assert.equal(s.calls.length, 0);
});

test('recordActivityInOwnTransaction commits as the writer role', async () => {
 const s = scripted();
 await recordActivityInOwnTransaction(s.pool, base);
 const stmts = s.calls.map(([q]) => q.split('\n')[0].slice(0, 40));
 assert.equal(stmts[0], 'BEGIN');
 assert.equal(s.calls[1][0], 'SET LOCAL ROLE titan_trusted_writer');
 assert.equal(insertCount(s.calls), 1);
 assert.equal(s.calls.at(-1)[0], 'COMMIT');
 assert.equal(s.released, 1);
});

test('recordActivityInOwnTransaction rolls back when the insert fails', async () => {
 const s = scripted((q) => { if (q.includes('INSERT INTO titan.activity_events')) throw new Error('check violation'); return { rows: [], rowCount: 1 }; });
 await assert.rejects(recordActivityInOwnTransaction(s.pool, base), /check violation/);
 assert.equal(s.calls.at(-1)[0], 'ROLLBACK');
 assert.equal(s.released, 1);
});

test('a refused event never connects in recordActivityInOwnTransaction', async () => {
 const pool = { async connect() { throw new Error('should not connect'); } };
 await assert.rejects(recordActivityInOwnTransaction(pool, { ...base, actorId: 'a@b.example' }), /email address/);
});

test('queryActivity runs as the trusted reader, scoped to the requested organisation, newest first', async () => {
 const rows = [{ event_id: 'e1', occurred_at: '2026-11-08T10:00:00Z', organisation_id: ORG, actor_kind: 'subject', actor_id: 'usr_admin', action: 'membership.update', target_type: 'membership', target_id: ID, source_product: 'central', outcome: 'success', correlation_id: REQ, detail: { role: 'manager' }, recorded_by: 'titan_trusted_writer' }];
 const s = scripted((q) => (q.includes('FROM titan.activity_events') ? { rows } : { rows: [], rowCount: 1 }));
 const out = await queryActivity(s.pool, ORG, { limit: 10 });
 assert.equal(s.calls[1][0], 'SET LOCAL ROLE titan_trusted_reader');
 assert.deepEqual(s.calls[2][1], [ORG]);
 const sel = s.calls.find(([q]) => q.includes('FROM titan.activity_events'));
 assert.match(sel[0], /WHERE organisation_id = \$1/);
 assert.deepEqual(sel[1], [ORG, null, 10]);
 assert.equal(out.length, 1);
 assert.equal(out[0].organisationId, ORG);
 assert.equal(s.calls.at(-1)[0], 'COMMIT');
 assert.equal(s.released, 1);
});

test('queryActivity refuses a row from another organisation', async () => {
 const rows = [{ event_id: 'e2', occurred_at: '2026-11-08T10:00:00Z', organisation_id: OTHER, actor_kind: 'subject', actor_id: 'usr_x', action: 'membership.update', target_type: 'membership', target_id: ID, source_product: 'central', outcome: 'success', correlation_id: REQ, detail: {}, recorded_by: 'titan_trusted_writer' }];
 const s = scripted((q) => (q.includes('FROM titan.activity_events') ? { rows } : { rows: [], rowCount: 1 }));
 await assert.rejects(queryActivity(s.pool, ORG), /scope violation/);
 assert.equal(s.calls.at(-1)[0], 'ROLLBACK');
});

test('queryActivity validates scope, page size and cursor before connecting', async () => {
 const pool = { async connect() { throw new Error('should not connect'); } };
 await assert.rejects(queryActivity(pool, ''), /organisation scope required/);
 await assert.rejects(queryActivity(pool, 'org-1'), /organisation scope required/);
 await assert.rejects(queryActivity(pool, ORG, { limit: 0 }), /page size/);
 await assert.rejects(queryActivity(pool, ORG, { limit: 101 }), /page size/);
 await assert.rejects(queryActivity(pool, ORG, { before: new Date('x') }), /cursor/);
});

test('queryActivity passes a keyset cursor to SQL', async () => {
 const s = scripted((q) => (q.includes('FROM titan.activity_events') ? { rows: [] } : { rows: [], rowCount: 1 }));
 await queryActivity(s.pool, ORG, { limit: 5, before: new Date('2026-11-08T10:00:00.000Z') });
 const sel = s.calls.find(([q]) => q.includes('FROM titan.activity_events'));
 assert.deepEqual(sel[1], [ORG, '2026-11-08T10:00:00.000Z', 5]);
});

// Provisioning integration: the event is written on the lifecycle transaction, before COMMIT.
const cmd = { kind: 'membership', id: ID, identityId: ID, organisationId: ORG, role: 'manager' };
const ctx = { requestId: REQ, actorSubject: 'usr_operator', authorityReference: 'logto:verified:123' };
test('provisioning writes the activity event inside the lifecycle transaction', async () => {
 const s = scripted((q) => (q.startsWith('SELECT command_kind') ? { rows: [] } : { rows: [{ id: ID, event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }], rowCount: 1 }));
 assert.equal(await new CentralProvisioner(s.pool).apply(ctx, cmd), 'created');
 const idx = s.calls.findIndex(([q]) => q.includes('INSERT INTO titan.activity_events'));
 const commit = s.calls.findIndex(([q]) => q === 'COMMIT');
 assert.ok(idx > 0 && idx < commit, 'activity insert happens before COMMIT');
 const params = s.calls[idx][1];
 assert.equal(params[2], ORG);
 assert.equal(params[4], 'usr_operator');
 assert.equal(params[5], 'membership.create');
 assert.equal(params[10], REQ);
 assert.equal(params[11], '{"role":"manager"}');
});

test('identity creation writes no activity event (no organisation to key it on)', async () => {
 const s = scripted((q) => (q.startsWith('SELECT command_kind') ? { rows: [] } : { rows: [{ id: ID }], rowCount: 1 }));
 await new CentralProvisioner(s.pool).apply({ ...ctx }, { kind: 'identity', id: ID, logtoSubject: 'usr_123' });
 assert.equal(insertCount(s.calls), 0);
});

test('a refused activity event rolls back the lifecycle change and its audit row', async () => {
 const s = scripted((q) => (q.startsWith('SELECT command_kind') ? { rows: [] } : { rows: [{ id: ID }], rowCount: 1 }));
 const pool = { async connect() { const c = await s.pool.connect(); return { query: async (q, p) => { if (q.includes('INSERT INTO titan.activity_events')) throw new Error('activity event refused: simulated'); return c.query(q, p); }, release() { c.release(); } }; } };
 await assert.rejects(new CentralProvisioner(pool).apply({ ...ctx, requestId: '11111111-1111-4111-8111-111111111112' }, cmd), /simulated/);
 assert.equal(s.calls.at(-1)[0], 'ROLLBACK');
 assert.equal(s.calls.some(([q]) => q === 'COMMIT'), false);
});
