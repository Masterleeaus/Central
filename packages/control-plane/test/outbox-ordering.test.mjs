import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleInbound, canonicalJson } from '../dist/index.js';

// Ordering contract (docs/EVENTS.md, "Ordering"):
//  - The PUBLISHER keeps each tenant's events in outbox order (claim rule, verified on PostgreSQL 16 in
//    tests/sql/outbox.sql and the harness described in docs/EVENTS.md).
//  - The CONSUMER helper does not reorder or buffer. It processes envelopes in arrival order.
//  - Duplicates (late or repeated) are ignored by the (consumer, idempotency key) dedupe.
//  - Nothing orders one tenant against another. These tests state that explicitly.

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const SECRET = 'x'.repeat(40);

function signed(organisationId, n) {
  const unsigned = { eventId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, organisationId, sourceProduct: 'desk',
    eventType: 'example', schemaVersion: 1, correlationId: 'c', idempotencyKey: `${organisationId.slice(-1).toUpperCase()}-${n}`,
    occurredAt: '2026-01-01T00:00:00.000Z', payload: { n } };
  const signature = createHmac('sha256', SECRET).update(canonicalJson(unsigned), 'utf8').digest('hex');
  return { ...unsigned, signature };
}

// Dedupe table keyed like titan.outbox_processed_events: (consumer, idempotency_key).
function dedupeTx(keys) {
  return { async query(text, values) {
    const k = `${values[0]}|${values[1]}`;
    if (keys.has(k)) return { rows: [], rowCount: 0 };
    keys.add(k);
    return { rows: [{ consumer: values[0] }], rowCount: 1 };
  } };
}

// One consumer stream: its own identity, its own dedupe table and its own effect log.
function stream(organisationId, consumerName = `inbox-${organisationId.slice(-1)}`) {
  const keys = new Set();
  const effects = [];
  const identity = { consumer: consumerName, organisationId, eventTypes: ['example'], secret: SECRET };
  return {
    effects,
    async deliver(envelope) {
      return handleInbound(dedupeTx(keys), identity, envelope, async (_tx, e) => { effects.push(e.idempotencyKey); });
    },
  };
}

test('per-tenant events are processed in the order they arrive, which is the publish order', async () => {
  const a = stream(ORG_A);
  for (const n of [1, 2, 3, 4]) assert.equal(await a.deliver(signed(ORG_A, n)), 'processed');
  assert.deepEqual(a.effects, ['A-1', 'A-2', 'A-3', 'A-4']);
});

test('a late duplicate of an earlier event is ignored and does not repeat its effect or move the order', async () => {
  const a = stream(ORG_A);
  await a.deliver(signed(ORG_A, 1));
  await a.deliver(signed(ORG_A, 2));
  await a.deliver(signed(ORG_A, 3));
  assert.equal(await a.deliver(signed(ORG_A, 1)), 'duplicate', 'late duplicate of event 1');
  assert.equal(await a.deliver(signed(ORG_A, 2)), 'duplicate', 'repeated event 2');
  await a.deliver(signed(ORG_A, 4));
  assert.deepEqual(a.effects, ['A-1', 'A-2', 'A-3', 'A-4']);
});

test('the consumer helper does not reorder: an event that arrives before its predecessor is processed when it arrives', async () => {
  // The publisher prevents this for one tenant (head-of-line claim rule). The consumer alone would not.
  const a = stream(ORG_A);
  assert.equal(await a.deliver(signed(ORG_A, 2)), 'processed');
  assert.equal(await a.deliver(signed(ORG_A, 1)), 'processed', 'the late predecessor is still processed, not buffered');
  assert.deepEqual(a.effects, ['A-2', 'A-1']);
});

test('ordering is not promised across tenants: a tenant B event can be handled between two tenant A events', async () => {
  const a = stream(ORG_A);
  const b = stream(ORG_B);
  await a.deliver(signed(ORG_A, 1));
  await b.deliver(signed(ORG_B, 1));
  await b.deliver(signed(ORG_B, 2));
  await a.deliver(signed(ORG_A, 2));
  // Each tenant's own order is intact. Their relative order is whatever the delivery interleaving produced.
  assert.deepEqual(a.effects, ['A-1', 'A-2']);
  assert.deepEqual(b.effects, ['B-1', 'B-2']);
});

test("a consumer bound to tenant A never applies tenant B's events, so they cannot disturb A's order", async () => {
  const a = stream(ORG_A);
  await assert.rejects(a.deliver(signed(ORG_B, 1)), (e) => e.code === 'tenant_mismatch');
  await a.deliver(signed(ORG_A, 1));
  assert.deepEqual(a.effects, ['A-1']);
});

test('a failed effect leaves the key unrecorded so a redelivery runs it in order', async () => {
  const keys = new Set();
  const identity = { consumer: 'inbox-A', organisationId: ORG_A, eventTypes: ['example'], secret: SECRET };
  const effects = [];
  let failOnce = true;
  const effect = async (_tx, e) => {
    if (e.idempotencyKey === 'A-2' && failOnce) { failOnce = false; throw new Error('handler down'); }
    effects.push(e.idempotencyKey);
  };
  // A transaction that rolls back on failure: the key is removed from the table when the effect throws.
  const run = async (n) => {
    const staged = new Set(keys);
    const tx = dedupeTx(staged);
    try {
      const outcome = await handleInbound(tx, identity, signed(ORG_A, n), effect);
      for (const k of staged) keys.add(k);
      return outcome;
    } catch (error) {
      return error.message;
    }
  };
  assert.equal(await run(1), 'processed');
  assert.equal(await run(2), 'handler down', 'failed effect: the attempt is rolled back');
  assert.equal(await run(2), 'processed', 'redelivery runs it once, in order');
  assert.equal(await run(2), 'duplicate');
  assert.deepEqual(effects, ['A-1', 'A-2']);
});
