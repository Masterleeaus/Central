import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpPublishTransport, createPublisher, assertConsumerEndpoint, TRANSPORT_MAX_BODY_BYTES, OutboxError } from '../dist/index.js';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const SECRET = 'x'.repeat(40);
const URL_A = 'https://desk.example.test/v1/outbox';
const URL_B = 'https://field.example.test/v1/outbox';
const envelope = (over = {}) => ({ eventId: '11111111-1111-4111-8111-111111111111', organisationId: ORG_A, sourceProduct: 'desk',
  eventType: 'example', schemaVersion: 1, correlationId: 'c', idempotencyKey: 'k-1', occurredAt: '2026-01-01T00:00:00.000Z',
  payload: { a: 1 }, signature: 'a'.repeat(64), ...over });
const target = { consumer: 'desk-inbox', organisationId: ORG_A };

// Records every call. The reply is a Response built from the scripted status, or a thrown error.
function fakeFetch(reply = { status: 204 }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(url, init);
    return new Response(null, { status: reply.status });
  };
  return { fn, calls };
}

test('POSTs the signed envelope as JSON with redirects refused and a timeout attached', async () => {
  const f = fakeFetch({ status: 202 });
  const transport = createHttpPublishTransport({ endpoints: [{ consumer: 'desk-inbox', url: URL_A }], fetch: f.fn });
  await transport.send(envelope(), target);
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, URL_A);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error', 'redirects are never followed');
  assert.ok(init.signal instanceof AbortSignal, 'request has a timeout signal');
  assert.equal(init.headers['content-type'], 'application/json');
  const body = JSON.parse(init.body);
  assert.equal(body.signature, 'a'.repeat(64), 'the envelope signature travels in the body');
  assert.doesNotMatch(init.body, new RegExp(SECRET));
});

test('an https endpoint with a path is accepted; http is refused unless it is localhost and the policy allows it', () => {
  assert.equal(assertConsumerEndpoint('c', URL_A, false), URL_A);
  assert.throws(() => assertConsumerEndpoint('c', 'http://desk.example.test/v1', false), (e) => e.code === 'insecure_endpoint');
  assert.throws(() => assertConsumerEndpoint('c', 'http://localhost:3000/v1', false), (e) => e.code === 'insecure_endpoint');
  assert.equal(assertConsumerEndpoint('c', 'http://localhost:3000/v1', true), 'http://localhost:3000/v1');
  assert.throws(() => assertConsumerEndpoint('c', 'http://127.0.0.1:3000/v1', true), (e) => e.code === 'insecure_endpoint', 'only the name localhost');
  assert.throws(() => assertConsumerEndpoint('c', 'http://evil.example.test/', true), (e) => e.code === 'insecure_endpoint');
  assert.throws(() => assertConsumerEndpoint('c', 'ftp://desk.example.test/', false), (e) => e.code === 'insecure_endpoint');
});

test('refusals name the consumer and never echo the URL or its credentials', () => {
  for (const bad of ['https://user:hunter2@desk.example.test/', 'https://desk.example.test/?token=abc123', 'https://desk.example.test/#frag', 'not a url']) {
    try {
      assertConsumerEndpoint('desk-inbox', bad, false);
      assert.fail(`expected refusal for ${bad}`);
    } catch (error) {
      assert.ok(error instanceof OutboxError, bad);
      assert.match(error.message, /desk-inbox/);
      assert.doesNotMatch(error.message, /hunter2|abc123|desk\.example/);
    }
  }
});

test('construction refuses a duplicate consumer endpoint and an out-of-range timeout', () => {
  assert.throws(() => createHttpPublishTransport({ endpoints: [{ consumer: 'c', url: URL_A }, { consumer: 'c', url: URL_B }] }), /more than one endpoint/);
  assert.throws(() => createHttpPublishTransport({ endpoints: [], timeoutMs: 0 }), /timeout out of range/);
  assert.throws(() => createHttpPublishTransport({ endpoints: [], timeoutMs: 61_000 }), /timeout out of range/);
});

test('a redirect, a server error or any non-2xx answer is a failed attempt', async () => {
  for (const status of [301, 302, 404, 500]) {
    const f = fakeFetch({ status });
    const transport = createHttpPublishTransport({ endpoints: [{ consumer: 'desk-inbox', url: URL_A }], fetch: f.fn });
    await assert.rejects(transport.send(envelope(), target), (e) => e.code === 'transport_failed' && e.message.includes(String(status)), `status ${status}`);
  }
});

test('a network failure is a failed attempt whose message carries no URL', async () => {
  const f = fakeFetch(Object.assign(new TypeError('fetch failed'), { name: 'TypeError' }));
  const transport = createHttpPublishTransport({ endpoints: [{ consumer: 'desk-inbox', url: URL_A }], fetch: f.fn });
  await assert.rejects(transport.send(envelope(), target), (e) => {
    assert.equal(e.code, 'transport_failed');
    assert.doesNotMatch(e.message, /desk\.example|https/);
    return true;
  });
});

test('a request that never answers is aborted by its timeout', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
  });
  const transport = createHttpPublishTransport({ endpoints: [{ consumer: 'desk-inbox', url: URL_A }], fetch: hang, timeoutMs: 20 });
  // AbortSignal.timeout is unref'd. A live socket keeps a real process running; this timer keeps the test alive.
  const keepAlive = setTimeout(() => {}, 5000);
  const started = Date.now();
  try {
    await assert.rejects(transport.send(envelope(), target), (e) => e.code === 'transport_failed' && /TimeoutError/.test(e.message));
  } finally {
    clearTimeout(keepAlive);
  }
  assert.ok(Date.now() - started < 2000);
});

test('an envelope over the body limit is refused before any request', async () => {
  const f = fakeFetch({ status: 204 });
  const transport = createHttpPublishTransport({ endpoints: [{ consumer: 'desk-inbox', url: URL_A }], fetch: f.fn });
  const huge = envelope({ payload: { blob: 'y'.repeat(TRANSPORT_MAX_BODY_BYTES + 1) } });
  await assert.rejects(transport.send(huge, target), (e) => e.code === 'payload_too_large');
  assert.equal(f.calls.length, 0);
});

test('an unknown consumer and an envelope for another tenant are refused before any request', async () => {
  const f = fakeFetch({ status: 204 });
  const transport = createHttpPublishTransport({ endpoints: [{ consumer: 'desk-inbox', url: URL_A }], fetch: f.fn });
  await assert.rejects(transport.send(envelope(), { consumer: 'nobody', organisationId: ORG_A }), (e) => e.code === 'route_mismatch');
  await assert.rejects(transport.send(envelope({ organisationId: ORG_B }), target), (e) => e.code === 'route_mismatch');
  assert.equal(f.calls.length, 0);
});

// Scripted pool, as in outbox-consumer.test.mjs: claims the given rows and records every statement.
function scriptedPool(rowsToClaim) {
  const sql = [];
  const pool = { async connect() { return { async query(text, values) {
    sql.push([text, values]);
    if (text.includes('FOR UPDATE SKIP LOCKED') && text.includes('WITH due AS')) return { rows: rowsToClaim };
    if (text.includes('SELECT attempts FROM titan.outbox_events')) return { rows: [{ attempts: 1 }] };
    if (text.includes("SET status = 'published'")) return { rows: [{ id: 'x' }] };
    return { rows: [] };
  }, release() {} }; } };
  return { pool, sql };
}
const claimedRow = (organisation_id) => ({ id: '11111111-1111-4111-8111-111111111111', organisation_id, source_product: 'desk', event_type: 'example',
  schema_version: 1, correlation_id: 'c', idempotency_key: 'k-1', payload: { a: 1 }, attempts: 1, created_at: '2026-01-01T00:00:00Z' });

test('through the publisher, a row for tenant A is POSTed only to tenant A endpoint, never to tenant B', async () => {
  const { pool } = scriptedPool([claimedRow(ORG_A)]);
  const f = fakeFetch({ status: 204 });
  const transport = createHttpPublishTransport({ endpoints: [
    { consumer: 'desk-a', url: URL_A }, { consumer: 'field-b', url: URL_B }], fetch: f.fn });
  const pub = createPublisher({ pool, transport, routes: [
    { consumer: 'desk-a', organisationId: ORG_A, eventTypes: ['example'], secret: SECRET },
    { consumer: 'field-b', organisationId: ORG_B, eventTypes: ['example'], secret: 'y'.repeat(40) }] });
  const report = await pub.runOnce();
  assert.equal(report.published, 1);
  assert.deepEqual(f.calls.map((c) => c.url), [URL_A]);
  assert.equal(JSON.parse(f.calls[0].init.body).organisationId, ORG_A);
});

test('a publisher failure through HTTP records a failed attempt and the redacted HTTP status', async () => {
  const { pool, sql } = scriptedPool([claimedRow(ORG_A)]);
  const f = fakeFetch({ status: 503 });
  const transport = createHttpPublishTransport({ endpoints: [{ consumer: 'desk-a', url: URL_A }], fetch: f.fn });
  const pub = createPublisher({ pool, transport, routes: [{ consumer: 'desk-a', organisationId: ORG_A, eventTypes: ['example'], secret: SECRET }] });
  const report = await pub.runOnce();
  assert.equal(report.failed, 1);
  const failure = sql.find(([t]) => t.includes('SET status = $2'));
  assert.match(failure[1][3], /HTTP 503/);
  assert.doesNotMatch(failure[1][3], /desk\.example/);
});
