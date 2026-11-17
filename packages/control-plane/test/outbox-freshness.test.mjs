// Freshness boundaries for inbound envelopes (issue #146). Main's handleInbound refuses envelopes whose
// occurredAt is more than 86400 s old or more than 300 s ahead of the consumer clock, measured in whole seconds.
// The window values are not exported, so these tests pin the boundaries through the public behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInbound } from '../dist/outbox-consumer.js';
import { OutboxError, canonicalJson } from '../dist/outbox.js';
import { createHmac } from 'node:crypto';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const SECRET = 'x'.repeat(40);
const NOW_MS = Date.parse('2026-11-15T10:00:00.000Z');
const MAX_AGE_S = 86_400;
const MAX_FUTURE_SKEW_S = 300;
const sign = (env) => { const { signature, ...u } = env; return createHmac('sha256', SECRET).update(canonicalJson(u)).digest('hex'); };
const envelope = (occurredMs, over = {}) => {
  const e = { eventId: '22222222-2222-4222-8222-222222222222', organisationId: ORG_A, sourceProduct: 'scheduled', eventType: 'example',
    schemaVersion: 1, correlationId: 'c', idempotencyKey: 'k-fresh', occurredAt: new Date(occurredMs).toISOString(), payload: { a: 1 }, ...over };
  e.signature = sign(e);
  return e;
};
const identity = { consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], secret: SECRET, now: () => NOW_MS };
function recordingTx() {
  const keys = new Set();
  return { keys, async query(_text, values) {
    const k = `${values[0]}|${values[1]}`;
    if (keys.has(k)) return { rows: [], rowCount: 0 };
    keys.add(k);
    return { rows: [{ consumer: values[0] }], rowCount: 1 };
  } };
}

test('an envelope exactly at the age limit (86400 s) is processed', async () => {
  const tx = recordingTx();
  let effects = 0;
  assert.equal(await handleInbound(tx, identity, envelope(NOW_MS - MAX_AGE_S * 1000), async () => { effects++; }), 'processed');
  assert.equal(effects, 1);
});

test('an envelope one second past the age limit is refused as stale before any effect or key record', async () => {
  const tx = recordingTx();
  let effects = 0;
  await assert.rejects(handleInbound(tx, identity, envelope(NOW_MS - (MAX_AGE_S + 1) * 1000), async () => { effects++; }),
    (error) => error instanceof OutboxError && error.code === 'stale');
  assert.equal(effects, 0);
  assert.equal(tx.keys.size, 0, 'a refused envelope must not record its idempotency key');
});

test('an envelope exactly at the future skew (300 s) is processed', async () => {
  const tx = recordingTx();
  assert.equal(await handleInbound(tx, identity, envelope(NOW_MS + MAX_FUTURE_SKEW_S * 1000), async () => {}), 'processed');
});

test('an envelope one second beyond the future skew is refused as from_future before any effect', async () => {
  const tx = recordingTx();
  let effects = 0;
  await assert.rejects(handleInbound(tx, identity, envelope(NOW_MS + (MAX_FUTURE_SKEW_S + 1) * 1000), async () => { effects++; }),
    (error) => error instanceof OutboxError && error.code === 'from_future');
  assert.equal(effects, 0);
  assert.equal(tx.keys.size, 0);
});

test('an unparseable occurredAt is refused as invalid_envelope, even though it is correctly signed', async () => {
  const bad = envelope(NOW_MS, { occurredAt: 'not-a-time' });
  await assert.rejects(handleInbound(recordingTx(), identity, bad, async () => {}), (error) => error instanceof OutboxError && error.code === 'invalid_envelope');
});

test('a bad signature is reported before freshness, so a forged timestamp is not probed for age', async () => {
  const forged = { ...envelope(NOW_MS - (MAX_AGE_S + 60) * 1000) };
  forged.signature = '0'.repeat(64);
  await assert.rejects(handleInbound(recordingTx(), identity, forged, async () => {}), (error) => error instanceof OutboxError && error.code === 'bad_signature');
});
