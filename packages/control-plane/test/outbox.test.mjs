import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutboxWriter, canonicalJson, redactError, prepareEvent, runInTransaction, OUTBOX_MAX_PAYLOAD_BYTES } from '../dist/outbox.js';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const REGISTRY = [{ eventType: 'example', schemaVersion: 1, sourceProducts: ['desk'] }];
const base = (over = {}) => ({ organisationId: ORG_A, sourceProduct: 'desk', eventType: 'example', schemaVersion: 1,
  correlationId: 'corr-1', idempotencyKey: 'key-1', payload: { ticket: 'T-1', n: 2 }, ...over });

// Fake transaction: enforces the unique idempotency key like the real table, and returns rows on lookup.
function fakeTx() {
  const rows = new Map();
  const log = [];
  return {
    rows, log,
    async query(text, values = []) {
      log.push([text, values]);
      if (text.startsWith('INSERT INTO titan.outbox_events')) {
        const key = values[5];
        if (rows.has(key)) return { rows: [], rowCount: 0 };
        rows.set(key, { organisation_id: values[0], source_product: values[1], event_type: values[2], schema_version: values[3], payload_digest: values[7] });
        return { rows: [{ id: 'x' }], rowCount: 1 };
      }
      if (text.startsWith('SELECT organisation_id, source_product')) {
        const r = rows.get(values[0]);
        return { rows: r ? [r] : [] };
      }
      throw new Error('unexpected SQL in fake: ' + text);
    },
  };
}

test('inserts one row inside the caller transaction and reports inserted', async () => {
  const tx = fakeTx();
  const writer = createOutboxWriter(REGISTRY);
  assert.equal(await writer.enqueue(tx, base()), 'inserted');
  assert.equal(tx.rows.size, 1);
  const insert = tx.log[0];
  assert.match(insert[0], /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.equal(insert[1][0], ORG_A);
  assert.equal(insert[1][6], '{"n":2,"ticket":"T-1"}');
});

test('same key and same payload is replayed and writes nothing new', async () => {
  const tx = fakeTx();
  const writer = createOutboxWriter(REGISTRY);
  await writer.enqueue(tx, base());
  assert.equal(await writer.enqueue(tx, base({ payload: { n: 2, ticket: 'T-1' } })), 'replayed');
  assert.equal(tx.rows.size, 1);
});

test('replay with a different correlation id is still replayed (correlation is not identity)', async () => {
  const tx = fakeTx();
  const writer = createOutboxWriter(REGISTRY);
  await writer.enqueue(tx, base());
  assert.equal(await writer.enqueue(tx, base({ correlationId: 'corr-2' })), 'replayed');
});

test('same key with a different payload is an idempotency conflict', async () => {
  const tx = fakeTx();
  const writer = createOutboxWriter(REGISTRY);
  await writer.enqueue(tx, base());
  await assert.rejects(writer.enqueue(tx, base({ payload: { ticket: 'T-2' } })), { code: 'idempotency_conflict' });
});

test('same key from another tenant is a conflict, never a replay', async () => {
  const tx = fakeTx();
  const writer = createOutboxWriter(REGISTRY);
  await writer.enqueue(tx, base());
  await assert.rejects(writer.enqueue(tx, base({ organisationId: ORG_B })), { code: 'idempotency_conflict' });
});

test('same key with a different event version or source is a conflict', async () => {
  const reg = [...REGISTRY, { eventType: 'example', schemaVersion: 2, sourceProducts: ['desk'] }];
  const tx = fakeTx();
  const writer = createOutboxWriter(reg);
  await writer.enqueue(tx, base());
  await assert.rejects(writer.enqueue(tx, base({ schemaVersion: 2 })), { code: 'idempotency_conflict' });
});

test('rejects a missing and a malformed tenant before any SQL', async () => {
  const tx = fakeTx();
  const writer = createOutboxWriter(REGISTRY);
  for (const bad of [undefined, null, '']) await assert.rejects(writer.enqueue(tx, base({ organisationId: bad })), { code: 'missing_tenant' });
  for (const bad of ['not-a-uuid', "x' OR 1=1--", 42]) await assert.rejects(writer.enqueue(tx, base({ organisationId: bad })), { code: 'invalid_tenant' });
  assert.equal(tx.log.length, 0);
});

test('rejects an unknown event type, an unknown version and an unlisted source', async () => {
  const tx = fakeTx();
  const writer = createOutboxWriter(REGISTRY);
  await assert.rejects(writer.enqueue(tx, base({ eventType: 'invoice_paid' })), { code: 'unknown_event_type' });
  await assert.rejects(writer.enqueue(tx, base({ schemaVersion: 9 })), { code: 'unknown_event_type' });
  await assert.rejects(writer.enqueue(tx, base({ sourceProduct: 'other' })), { code: 'source_not_allowed' });
  assert.equal(tx.log.length, 0);
});

test('production registry is empty, so no business event can be written yet', async () => {
  const writer = createOutboxWriter([]);
  await assert.rejects(writer.enqueue(fakeTx(), base()), { code: 'unknown_event_type' });
});

test('rejects an oversized payload and accepts one at the limit', async () => {
  const tx = fakeTx();
  const writer = createOutboxWriter(REGISTRY);
  await assert.rejects(writer.enqueue(tx, base({ payload: { blob: 'x'.repeat(OUTBOX_MAX_PAYLOAD_BYTES) } })), { code: 'payload_too_large' });
  const fits = 'x'.repeat(OUTBOX_MAX_PAYLOAD_BYTES - canonicalJson({ blob: '' }).length);
  assert.equal(await writer.enqueue(tx, base({ idempotencyKey: 'key-fit', payload: { blob: fits } })), 'inserted');
});

test('rejects non-object payloads and non-JSON values', async () => {
  const writer = createOutboxWriter(REGISTRY);
  await assert.rejects(writer.enqueue(fakeTx(), base({ payload: [1] })), { code: 'invalid_payload' });
  await assert.rejects(writer.enqueue(fakeTx(), base({ payload: { when: new Date(0), f: () => 1 } })), { code: 'invalid_payload' });
  await assert.rejects(writer.enqueue(fakeTx(), base({ payload: { n: Number.NaN } })), { code: 'invalid_payload' });
});

test('canonical JSON is key-order independent and deterministic', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } }), '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  assert.equal(prepareEvent(REGISTRY, base({ payload: { a: 1, b: 2 } })).payloadDigest, prepareEvent(REGISTRY, base({ payload: { b: 2, a: 1 } })).payloadDigest);
});

test('redacts credentials and bounds stored errors', () => {
  const out = redactError(new Error('connect postgresql://user:hunter2@db/x failed; password=abc123 Bearer eyJhbGciOi.x token: t0k'));
  assert.doesNotMatch(out, /hunter2|abc123|eyJhbGci|t0k/);
  assert.match(out, /\[redacted/);
  assert.ok(redactError('a'.repeat(5000)).length <= 512);
  assert.equal(redactError(''), 'unknown error');
});

test('runInTransaction commits on success and rolls back on failure', async () => {
  const calls = [];
  let released = 0;
  const pool = { async connect() { return { async query(t) { calls.push(t); return { rows: [] }; }, release() { released++; } }; } };
  assert.equal(await runInTransaction(pool, async () => 7), 7);
  await assert.rejects(runInTransaction(pool, async () => { throw new Error('state change failed'); }), /state change failed/);
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'BEGIN', 'ROLLBACK']);
  assert.equal(released, 2);
});
