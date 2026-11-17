import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  PRODUCTION_EVENT_REGISTRY, createOutboxWriter, runInTransaction, createPublisher, replayDeadEvent,
  handleInbound, verifyEnvelopeSignature, canonicalJson,
} from '../dist/index.js';
import { memoryOutboxStore } from './helpers/memory-outbox-store.mjs';

// Outbox lifecycle against the in-memory store: atomic enqueue, idempotent writes, bounded retries,
// dead letters, operator replay, head-of-line order, and tenant isolation of delivery.

const fixture = JSON.parse(readFileSync(new URL('./fixtures/outbox/booking-created.v1.json', import.meta.url), 'utf8'));
const ORG_A = fixture.organisationId;
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const SECRET_A = 'a'.repeat(40);
const SECRET_B = 'b'.repeat(40);
const writer = createOutboxWriter(PRODUCTION_EVENT_REGISTRY);
const routeA = { consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['booking_created'], secret: SECRET_A };
const routeB = { consumer: 'field-inbox', organisationId: ORG_B, eventTypes: ['booking_created'], secret: SECRET_B };

function input(over = {}) {
  return { ...fixture, ...over, payload: { ...fixture.payload, ...(over.payload ?? {}) } };
}

async function enqueue(pool, over = {}) {
  return runInTransaction(pool, (tx) => writer.enqueue(tx, input(over)));
}

// Recording transport. `fail` decides per call whether to throw.
function recordingTransport(fail = () => false) {
  const sent = [];
  return { sent, transport: { async send(envelope, target) {
    if (fail(envelope, target)) throw new Error('consumer down at https://consumer.example/hook?token=abc123');
    sent.push({ envelope, target });
  } } };
}

test('state change and outbox row commit together; a rolled-back change leaves no event', async () => {
  const store = memoryOutboxStore();
  await assert.rejects(runInTransaction(store.pool, async (tx) => {
    await writer.enqueue(tx, input());
    throw new Error('state change failed');
  }), /state change failed/);
  assert.equal(store.rows().length, 0);
  assert.equal(store.audit().length, 0);

  assert.equal(await enqueue(store.pool), 'inserted');
  assert.equal(store.rows().length, 1);
});

test('a repeated enqueue with the same key and payload is a replay and adds no row', async () => {
  const store = memoryOutboxStore();
  assert.equal(await enqueue(store.pool), 'inserted');
  assert.equal(await enqueue(store.pool, { correlationId: 'req-retry' }), 'replayed');
  assert.equal(store.rows().length, 1);
});

test('a published event is signed for its route and never sent to another tenant', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const { sent, transport } = recordingTransport();
  const pub = createPublisher({ pool: store.pool, transport, routes: [routeA, routeB], now: () => store.clock.ms });
  assert.deepEqual(await pub.runOnce(), { claimed: 1, published: 1, failed: 0, dead: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].target.organisationId, ORG_A);
  assert.equal(sent[0].envelope.organisationId, ORG_A);
  assert.equal(verifyEnvelopeSignature(sent[0].envelope, SECRET_A), true);
  assert.equal(verifyEnvelopeSignature(sent[0].envelope, SECRET_B), false);
  assert.equal(store.rows()[0].status, 'published');
  assert.deepEqual(store.audit().map((a) => a.action), ['published']);
});

test('tenant B events are delivered only to tenant B, even when both tenants share one outbox', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  await enqueue(store.pool, { organisationId: ORG_B, idempotencyKey: 'scheduled:booking:B-2001:created', correlationId: 'req-b' });
  const { sent, transport } = recordingTransport();
  const pub = createPublisher({ pool: store.pool, transport, routes: [routeA, routeB], now: () => store.clock.ms });
  await pub.runOnce();
  const toA = sent.filter((s) => s.target.consumer === 'desk-inbox');
  const toB = sent.filter((s) => s.target.consumer === 'field-inbox');
  assert.equal(toA.length, 1);
  assert.equal(toB.length, 1);
  assert.ok(toA.every((s) => s.envelope.organisationId === ORG_A));
  assert.ok(toB.every((s) => s.envelope.organisationId === ORG_B));
});

test('a consumer bound to tenant B refuses a tenant A envelope even when it is correctly signed', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const { sent, transport } = recordingTransport();
  await createPublisher({ pool: store.pool, transport, routes: [routeA], now: () => store.clock.ms }).runOnce();
  const seen = new Set();
  const tx = { async query(text, values) {
    const k = `${values[0]}|${values[1]}`;
    if (seen.has(k)) return { rows: [], rowCount: 0 };
    seen.add(k);
    return { rows: [{ consumer: values[0] }], rowCount: 1 };
  } };
  const consumerB = { consumer: 'field-inbox', organisationId: ORG_B, eventTypes: ['booking_created'], secret: SECRET_A };
  await assert.rejects(handleInbound(tx, consumerB, sent[0].envelope, async () => {}), { code: 'tenant_mismatch' });
  assert.equal(seen.size, 0, 'nothing is recorded for a refused envelope');
});

test('a failing consumer is retried with bounded backoff, then dead-lettered with an audit trail', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const maxAttempts = 3;
  const { transport } = recordingTransport(() => true);
  const pub = createPublisher({ pool: store.pool, transport, routes: [routeA], maxAttempts, now: () => store.clock.ms });
  const eventId = store.rows()[0].id;

  const reports = [];
  for (let i = 0; i < maxAttempts; i += 1) {
    reports.push(await pub.runOnce());
    store.advance(16 * 60 * 1000); // longer than the backoff cap, so every retry is due
  }
  assert.deepEqual(reports.map((r) => r.failed), [1, 1, 1]);
  assert.equal(reports[2].dead, 1);
  const row = store.row(eventId);
  assert.equal(row.status, 'dead');
  assert.equal(row.attempts, maxAttempts);
  assert.deepEqual(store.audit().map((a) => a.action), ['attempt_failed', 'attempt_failed', 'attempt_failed', 'dead']);
  assert.ok(store.audit().every((a) => a.event_id === eventId && a.actor === 'outbox-publisher'));
  assert.doesNotMatch(row.last_error, /abc123|https:\/\//, 'stored error is redacted');

  // A dead event is not claimed again.
  assert.deepEqual(await pub.runOnce(), { claimed: 0, published: 0, failed: 0, dead: 0 });
});

test('backoff between retries grows and is recorded on the row', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const { transport } = recordingTransport(() => true);
  const pub = createPublisher({ pool: store.pool, transport, routes: [routeA], now: () => store.clock.ms, baseBackoffSeconds: 5, maxBackoffSeconds: 900 });
  const start = store.clock.ms;
  const gaps = [];
  for (let i = 0; i < 3; i += 1) {
    await pub.runOnce();
    gaps.push((store.rows()[0].next_attempt_at - start) / 1000);
    store.advance(store.rows()[0].next_attempt_at - store.clock.ms);
  }
  assert.deepEqual(gaps, [5, 15, 35]);
});

test('a retrying event holds back its tenant later events; a dead event does not', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool, { idempotencyKey: 'scheduled:booking:B-1:created', payload: { bookingId: 'B-1' } });
  await enqueue(store.pool, { idempotencyKey: 'scheduled:booking:B-2:created', payload: { bookingId: 'B-2' } });
  let failFirst = true;
  const { sent, transport } = recordingTransport((env) => failFirst && env.payload.bookingId === 'B-1');
  const pub = createPublisher({ pool: store.pool, transport, routes: [routeA], maxAttempts: 2, now: () => store.clock.ms });

  assert.equal((await pub.runOnce()).published, 0, 'the second event waits behind the first');
  assert.equal(sent.length, 0);
  store.advance(60 * 60 * 1000);
  await pub.runOnce(); // second and final attempt of the first event
  assert.equal(store.rows().find((r) => r.payload.bookingId === 'B-1').status, 'dead');
  store.advance(60 * 60 * 1000);
  failFirst = false;
  const report = await pub.runOnce();
  assert.equal(report.published, 1, 'the dead event no longer blocks its tenant');
  assert.equal(sent[0].envelope.payload.bookingId, 'B-2');
});

test('operator replay returns a dead event to pending with a full retry budget, and is audited', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const eventId = store.rows()[0].id;
  let down = true;
  const { sent, transport } = recordingTransport(() => down);
  const pub = createPublisher({ pool: store.pool, transport, routes: [routeA], maxAttempts: 1, now: () => store.clock.ms });
  await pub.runOnce();
  assert.equal(store.row(eventId).status, 'dead');

  await replayDeadEvent(store.pool, eventId, 'ops-jane', 'consumer fixed, replaying');
  const replayed = store.row(eventId);
  assert.equal(replayed.status, 'pending');
  assert.equal(replayed.attempts, 0);
  const replay = store.audit().find((a) => a.action === 'operator_replay');
  assert.equal(replay.actor, 'ops-jane');
  assert.equal(replay.detail, 'consumer fixed, replaying');

  down = false;
  assert.equal((await pub.runOnce()).published, 1);
  assert.equal(sent.length, 1);
  assert.equal(store.row(eventId).status, 'published');
});

test('operator replay refuses an event that is not dead and writes no audit row', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const eventId = store.rows()[0].id;
  await assert.rejects(replayDeadEvent(store.pool, eventId, 'ops-jane', 'nothing to fix'), { code: 'not_dead' });
  assert.equal(store.row(eventId).status, 'pending');
  assert.equal(store.audit().some((a) => a.action === 'operator_replay'), false);
});

test('an event whose lease expired after its final attempt is dead-lettered without being sent again', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const eventId = store.rows()[0].id;
  const { sent, transport } = recordingTransport();
  const pub = createPublisher({ pool: store.pool, transport, routes: [routeA], maxAttempts: 2, now: () => store.clock.ms });
  // State after a worker claimed the final attempt and crashed: attempts used up, lease already expired.
  Object.assign(store.row(eventId), { attempts: 2, next_attempt_at: store.clock.ms - 1 });
  const report = await pub.runOnce();
  assert.equal(report.claimed, 0);
  assert.equal(store.row(eventId).status, 'dead');
  assert.equal(store.row(eventId).last_error, 'lease expired after final attempt');
  assert.ok(store.audit().some((a) => a.action === 'dead' && a.detail === 'lease expired after final attempt'));
  assert.equal(sent.length, 0);
});

test('a row with no consumer route stays pending, is retried, and becomes dead with a visible route error', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const eventId = store.rows()[0].id;
  const { transport } = recordingTransport();
  const pub = createPublisher({ pool: store.pool, transport, routes: [routeB], maxAttempts: 2, now: () => store.clock.ms });
  await pub.runOnce();
  store.advance(16 * 60 * 1000);
  await pub.runOnce();
  assert.equal(store.row(eventId).status, 'dead');
  assert.match(store.row(eventId).last_error, /no consumer route/);
});

test('the same envelope redelivered after a lost acknowledgement is processed once by the consumer', async () => {
  const store = memoryOutboxStore();
  await enqueue(store.pool);
  const { sent, transport } = recordingTransport();
  await createPublisher({ pool: store.pool, transport, routes: [routeA], now: () => store.clock.ms }).runOnce();
  const recorded = new Set();
  let effects = 0;
  const tx = { async query(text, values) {
    const k = `${values[0]}|${values[1]}`;
    if (recorded.has(k)) return { rows: [], rowCount: 0 };
    recorded.add(k);
    return { rows: [{ consumer: values[0] }], rowCount: 1 };
  } };
  // The publisher and inbound consumer must share the deterministic scenario clock;
  // using wall time would incorrectly treat this fixture as a stale real event.
  const consumer = { consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['booking_created'], secret: SECRET_A, now: () => store.clock.ms };
  const outcomes = [];
  for (let i = 0; i < 2; i += 1) {
    outcomes.push(await handleInbound(tx, consumer, sent[0].envelope, async () => { effects += 1; }));
  }
  assert.deepEqual(outcomes, ['processed', 'duplicate']);
  assert.equal(effects, 1);
  assert.equal(canonicalJson(sent[0].envelope.payload), canonicalJson(fixture.payload));
});
