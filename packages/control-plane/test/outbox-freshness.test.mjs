// Freshness window for inbound envelopes (issue #146). Window values match Scheduled's verifier:
// 86400 s of age and 300 s of future skew, measured against the consumer clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInbound, MAX_ENVELOPE_AGE_MS, MAX_ENVELOPE_FUTURE_SKEW_MS } from '../dist/outbox-consumer.js';
import { OutboxError, canonicalJson } from '../dist/outbox.js';
import { createHmac } from 'node:crypto';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const SECRET = 'x'.repeat(40);
const NOW_MS = Date.parse('2026-11-15T10:00:00.000Z');
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

test('window constants are 86400 seconds of age and 300 seconds of future skew', () => {
  assert.equal(MAX_ENVELOPE_AGE_MS, 86_400_000);
  assert.equal(MAX_ENVELOPE_FUTURE_SKEW_MS, 300_000);
});

test('an envelope exactly at the age limit is processed', async () => {
  const tx = recordingTx();
  let effects = 0;
  assert.equal(await handleInbound(tx, identity, envelope(NOW_MS - MAX_ENVELOPE_AGE_MS), async () => { effects++; }), 'processed');
  assert.equal(effects, 1);
});

test('an envelope one millisecond past the age limit is refused as stale before any effect or key record', async () => {
  const tx = recordingTx();
  let effects = 0;
  await assert.rejects(handleInbound(tx, identity, envelope(NOW_MS - MAX_ENVELOPE_AGE_MS - 1), async () => { effects++; }),
    (error) => error instanceof OutboxError && error.code === 'stale');
  assert.equal(effects, 0);
  assert.equal(tx.keys.size, 0, 'a refused envelope must not record its idempotency key');
});

test('an envelope exactly at the future skew is processed', async () => {
  const tx = recordingTx();
  assert.equal(await handleInbound(tx, identity, envelope(NOW_MS + MAX_ENVELOPE_FUTURE_SKEW_MS), async () => {}), 'processed');
});

test('an envelope one millisecond beyond the future skew is refused as from_future before any effect', async () => {
  const tx = recordingTx();
  let effects = 0;
  await assert.rejects(handleInbound(tx, identity, envelope(NOW_MS + MAX_ENVELOPE_FUTURE_SKEW_MS + 1), async () => { effects++; }),
    (error) => error instanceof OutboxError && error.code === 'from_future');
  assert.equal(effects, 0);
  assert.equal(tx.keys.size, 0);
});

test('an unparseable occurredAt is refused as invalid_envelope, even though it is correctly signed', async () => {
  const bad = envelope(NOW_MS, { occurredAt: 'not-a-time' });
  await assert.rejects(handleInbound(recordingTx(), identity, bad, async () => {}), (error) => error instanceof OutboxError && error.code === 'invalid_envelope');
});

test('a bad signature is reported before freshness, so a forged timestamp is not probed for age', async () => {
  const forged = { ...envelope(NOW_MS - MAX_ENVELOPE_AGE_MS - 60_000) };
  forged.signature = '0'.repeat(64);
  await assert.rejects(handleInbound(recordingTx(), identity, forged, async () => {}), (error) => error instanceof OutboxError && error.code === 'bad_signature');
});
