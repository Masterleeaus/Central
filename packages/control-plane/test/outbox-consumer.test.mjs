import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInbound } from '../dist/outbox-consumer.js';
import { verifyEnvelopeSignature, createPublisher, backoffSeconds, replayDeadEvent } from '../dist/outbox-publisher.js';
import { canonicalJson } from '../dist/outbox.js';
import { createHmac } from 'node:crypto';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const SECRET = 'x'.repeat(40);
const sign = (env, secret = SECRET) => { const { signature, ...u } = env; return createHmac('sha256', secret).update(canonicalJson(u)).digest('hex'); };
const envelope = (over = {}) => {
  const e = { eventId: '11111111-1111-4111-8111-111111111111', organisationId: ORG_A, sourceProduct: 'desk', eventType: 'example',
    schemaVersion: 1, correlationId: 'c', idempotencyKey: 'k-1', occurredAt: '2026-01-01T00:00:00.000Z', payload: { a: 1 }, ...over };
  e.signature = sign(e);
  return e;
};
const consumer = { consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], secret: SECRET };

// Fake transaction backed by a Set of recorded keys, mirroring the primary key on (consumer, idempotency_key).
function fakeTx(keys = new Set()) {
  return { keys, async query(text, values) {
    assert.match(text, /titan\.outbox_processed_events/);
    const k = `${values[0]}|${values[1]}`;
    if (keys.has(k)) return { rows: [], rowCount: 0 };
    keys.add(k);
    return { rows: [{ consumer: values[0] }], rowCount: 1 };
  } };
}

test('a delivery runs the effect once; a duplicate returns duplicate and does not repeat the effect', async () => {
  const keys = new Set();
  let runs = 0;
  const effect = async () => { runs++; };
  assert.equal(await handleInbound(fakeTx(keys), consumer, envelope(), effect), 'processed');
  assert.equal(await handleInbound(fakeTx(keys), consumer, envelope(), effect), 'duplicate');
  assert.equal(runs, 1);
});

test('a failing effect is propagated, so the caller rolls the key back with its transaction', async () => {
  const keys = new Set();
  await assert.rejects(handleInbound(fakeTx(keys), consumer, envelope(), async () => { throw new Error('side effect failed'); }), /side effect failed/);
  // The key was written through tx; the real rollback is verified on PostgreSQL (tests/sql/outbox.sql).
  assert.equal(keys.size, 1);
});

test('rejects a forged or altered envelope before recording anything', async () => {
  const keys = new Set();
  const forged = envelope({ payload: { a: 2 } });
  forged.signature = 'a'.repeat(64);
  await assert.rejects(handleInbound(fakeTx(keys), consumer, forged, async () => {}), { code: 'bad_signature' });
  await assert.rejects(handleInbound(fakeTx(keys), consumer, { ...envelope(), payload: { a: 9 } }), { code: 'bad_signature' });
  assert.equal(keys.size, 0);
});

test("a consumer bound to tenant B rejects tenant A's event even with a valid signature", async () => {
  const keys = new Set();
  const forB = { ...consumer, organisationId: ORG_B };
  await assert.rejects(handleInbound(fakeTx(keys), forB, envelope(), async () => {}), { code: 'tenant_mismatch' });
  assert.equal(keys.size, 0);
});

test('a consumer rejects event types it does not accept', async () => {
  await assert.rejects(handleInbound(fakeTx(), { ...consumer, eventTypes: ['other'] }, envelope(), async () => {}), { code: 'unknown_event_type' });
});

test('signature verification is per secret', () => {
  assert.equal(verifyEnvelopeSignature(envelope(), SECRET), true);
  assert.equal(verifyEnvelopeSignature(envelope(), 'y'.repeat(40)), false);
});

test('backoff doubles and is capped', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => backoffSeconds(n, 5, 900)), [5, 10, 20, 40, 80]);
  assert.equal(backoffSeconds(40, 5, 900), 900);
});

// Scripted pool: claim returns the given rows; UPDATE/SELECT statements are recorded.
function scriptedPool(rowsToClaim) {
  const sql = [];
  const pool = { async connect() { return { async query(text, values) {
    sql.push([text, values]);
    if (text.includes('FOR UPDATE SKIP LOCKED') && text.includes('WITH due AS')) return { rows: rowsToClaim };
    if (text.includes('SELECT attempts FROM titan.outbox_events')) return { rows: [{ attempts: rowsToClaim[0]?.attempts ?? 1 }] };
    if (text.includes("SET status = 'published'")) return { rows: [{ id: 'x' }] };
    if (text.includes('SET status = $2')) return { rows: [] };
    return { rows: [] };
  }, release() {} }; } };
  return { pool, sql };
}
const claimedRow = (over = {}) => ({ id: '11111111-1111-4111-8111-111111111111', organisation_id: ORG_A, source_product: 'desk', event_type: 'example',
  schema_version: 1, correlation_id: 'c', idempotency_key: 'k-1', payload: { a: 1 }, attempts: 1, created_at: '2026-01-01T00:00:00Z', ...over });
const routeA = { consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], secret: SECRET };

test('publisher sends only to the matching tenant route and marks published', async () => {
  const { pool, sql } = scriptedPool([claimedRow()]);
  const sent = [];
  const pub = createPublisher({ pool, routes: [routeA], transport: { async send(env, target) { sent.push([env, target]); } } });
  const report = await pub.runOnce();
  assert.deepEqual(report, { claimed: 1, published: 1, failed: 0, dead: 0 });
  assert.equal(sent[0][1].organisationId, ORG_A);
  assert.equal(verifyEnvelopeSignature(sent[0][0], SECRET), true);
  assert.ok(sql.some(([t]) => t.includes("SET status = 'published'")));
});

test("a row for tenant A is never handed to a route bound to tenant B", async () => {
  const { pool } = scriptedPool([claimedRow()]);
  const sent = [];
  const pub = createPublisher({ pool, routes: [{ ...routeA, organisationId: ORG_B }], transport: { async send(env, target) { sent.push(target); } } });
  const report = await pub.runOnce();
  assert.equal(sent.length, 0);
  assert.equal(report.failed, 1);
});

test('a transport failure is recorded as a failed attempt with a redacted error', async () => {
  const { pool, sql } = scriptedPool([claimedRow({ attempts: 2 })]);
  const pub = createPublisher({ pool, routes: [routeA], transport: { async send() { throw new Error('down: password=s3cret'); } } });
  const report = await pub.runOnce();
  assert.equal(report.failed, 1);
  const failure = sql.find(([t]) => t.includes('SET status = $2'));
  assert.ok(failure);
  assert.doesNotMatch(failure[1][3], /s3cret/);
});

test('duplicate tenant and event routes are refused at construction', () => {
  assert.throws(() => createPublisher({ pool: {}, transport: { send: async () => {} }, routes: [routeA, { ...routeA, consumer: 'other' }] }), /more than one consumer/);
});

test('short secrets and out-of-range limits are refused at construction', () => {
  assert.throws(() => createPublisher({ pool: {}, transport: { send: async () => {} }, routes: [{ ...routeA, secret: 'short' }] }), /too short/);
  assert.throws(() => createPublisher({ pool: {}, transport: { send: async () => {} }, routes: [], maxAttempts: 0 }), /maxAttempts/);
});

test('operator replay requires an operator and a reason, and is refused early for bad input', async () => {
  await assert.rejects(replayDeadEvent({ connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) }, '11111111-1111-4111-8111-111111111111', '  ', 'why'), { code: 'invalid_field' });
  await assert.rejects(replayDeadEvent({ connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) }, '11111111-1111-4111-8111-111111111111', 'ops', ''), { code: 'invalid_field' });
  await assert.rejects(replayDeadEvent({ connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) }, 'nope', 'ops', 'why'), { code: 'invalid_field' });
});
