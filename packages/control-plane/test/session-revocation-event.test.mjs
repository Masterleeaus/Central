// Signed session_revoked events for membership reductions (issues #6, #102). In-memory fake; no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CentralProvisioner } from '../dist/provisioning.js';
import { SESSION_REVOKED_EVENT, enqueueSessionRevoked, PRODUCTION_EVENT_REGISTRY, prepareEvent } from '../dist/index.js';

const ORG = '33333333-3333-4333-8333-333333333333';
const IDENT = '44444444-4444-4444-8444-444444444444';
const reqId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx = (n) => ({ requestId: reqId(n), actorSubject: 'admin_1', authorityReference: 'policy:1' });

/** Minimal database: one membership, audit rows, revocation generations, outbox rows. Tracks statements for rollback checks. */
function makeDb({ role = 'manager', failOutbox = false } = {}) {
  const db = { membership: { id: IDENT, organisation_id: ORG, role, state: 'active', revision: 1, logto_subject: 'usr_1' },
    generations: new Map(), audit: [], outbox: [], statements: [] };
  const handle = (q, p) => {
    db.statements.push(q.split('\n')[0].slice(0, 60));
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(q) || q.startsWith('SELECT pg_advisory')) return { rows: [], rowCount: 0 };
    if (q.startsWith('SELECT command_kind')) return { rows: db.audit.filter((a) => a.request_id === p[0]), rowCount: 0 };
    if (q.includes('FOR UPDATE OF m')) return { rows: [{ ...db.membership }], rowCount: 1 };
    if (q.startsWith('UPDATE titan.memberships')) { db.membership.role = p[2]; db.membership.state = p[3]; db.membership.revision++; return { rowCount: 1, rows: [] }; }
    if (q.startsWith('INSERT INTO titan.titan_session_revocations')) {
      const k = `${p[0]}|${p[1]}|${p[2]}`; const g = (db.generations.get(k) ?? 0) + 1; db.generations.set(k, g);
      return { rows: [{ generation: g }], rowCount: 1 };
    }
    if (q.startsWith('INSERT INTO titan.outbox_events')) {
      if (failOutbox) throw Error('outbox unavailable');
      if (db.outbox.some((e) => e.idempotency_key === p[5])) return { rows: [], rowCount: 0 };
      db.outbox.push({ organisation_id: p[0], source_product: p[1], event_type: p[2], schema_version: p[3], idempotency_key: p[5], payload: JSON.parse(p[6]) });
      return { rows: [{ id: 'evt' }], rowCount: 1 };
    }
    if (q.startsWith('INSERT INTO titan.provisioning_audit')) { db.audit.push({ request_id: p[0], command_kind: p[3], command_digest: p[4] }); return { rowCount: 1, rows: [] }; }
    if (q.startsWith('INSERT INTO titan.activity_events')) return { rowCount: 1, rows: [] };
    throw Error('unhandled SQL in fixture: ' + q.slice(0, 60));
  };
  const pool = { async connect() { return { query: async (q, p) => handle(q, p), release() {} }; } };
  return { db, pool };
}
const suspend = (extra = {}) => ({ kind: 'membership_update', id: IDENT, organisationId: ORG, expectedRevision: 1, state: 'suspended', ...extra });

test('suspending a membership writes one signed session_revoked event per application, in the same transaction', async () => {
  const { db, pool } = makeDb();
  assert.equal(await new CentralProvisioner(pool).apply(ctx(1), suspend()), 'updated');
  assert.equal(db.outbox.length, 3);
  assert.deepEqual(db.outbox.map((e) => e.payload.applicationId).sort(), ['academy', 'desk', 'field']);
  for (const e of db.outbox) {
    assert.equal(e.organisation_id, ORG);
    assert.equal(e.source_product, 'central');
    assert.equal(e.event_type, SESSION_REVOKED_EVENT.eventType);
    assert.equal(e.schema_version, 1);
    assert.deepEqual(Object.keys(e.payload).sort(), ['applicationId', 'generation', 'logtoSubject']);
    assert.equal(e.payload.logtoSubject, 'usr_1');
    assert.equal(e.payload.generation, 1);
  }
  const commit = db.statements.lastIndexOf('COMMIT');
  assert.ok(db.statements.indexOf('INSERT INTO titan.outbox_events') < commit, 'event is written before COMMIT');
});

test('a role promotion is not a reduction and writes no revocation event', async () => {
  const { db, pool } = makeDb({ role: 'member' });
  await new CentralProvisioner(pool).apply(ctx(2), { kind: 'membership_update', id: IDENT, organisationId: ORG, expectedRevision: 1, role: 'admin' });
  assert.equal(db.outbox.length, 0);
});

test('a failed event write rolls back the generation bump and the audit row', async () => {
  const { db, pool } = makeDb({ failOutbox: true });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(3), suspend()), /outbox unavailable/);
  assert.ok(db.statements.includes('ROLLBACK'));
  assert.equal(db.statements.includes('COMMIT'), false);
});

test('a replayed request writes no second event and no second bump', async () => {
  const { db, pool } = makeDb();
  await new CentralProvisioner(pool).apply(ctx(4), suspend());
  assert.equal(await new CentralProvisioner(pool).apply(ctx(4), suspend()), 'replayed');
  assert.equal(db.outbox.length, 3);
  assert.equal(db.generations.get('desk|usr_1|' + ORG), 1);
});

test('the registry accepts session_revoked only from central, and rejects a payload without the generation', () => {
  assert.ok(PRODUCTION_EVENT_REGISTRY.some((d) => d.eventType === 'session_revoked' && d.sourceProducts.join() === 'central'));
  const base = { organisationId: ORG, sourceProduct: 'central', eventType: 'session_revoked', schemaVersion: 1, correlationId: 'c', idempotencyKey: 'k' };
  assert.doesNotThrow(() => prepareEvent(PRODUCTION_EVENT_REGISTRY, { ...base, payload: { applicationId: 'desk', logtoSubject: 'usr_1', generation: 1 } }));
  assert.throws(() => prepareEvent(PRODUCTION_EVENT_REGISTRY, { ...base, payload: { applicationId: 'desk', logtoSubject: 'usr_1' } }), /generation/);
  assert.throws(() => prepareEvent(PRODUCTION_EVENT_REGISTRY, { ...base, sourceProduct: 'desk', payload: { applicationId: 'desk', logtoSubject: 'usr_1', generation: 1 } }), /source/);
});

test('enqueueSessionRevoked keys the event by generation, so each generation is one event', async () => {
  const rows = [];
  const tx = { query: async (q, p) => { rows.push(p); return { rows: [{ id: 'x' }], rowCount: 1 }; } };
  await enqueueSessionRevoked(tx, { organisationId: ORG, applicationId: 'field', logtoSubject: 'usr_1', generation: 7 });
  assert.equal(rows[0][5], `session_revoked:${ORG}:field:usr_1:7`);
});
