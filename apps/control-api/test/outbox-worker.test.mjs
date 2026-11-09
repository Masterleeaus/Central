import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readOutboxWorkerConfig, readRouteConfig, runOutboxLoop, runOutboxWorker, interruptibleSleep } from '../src/outbox-worker.mjs';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const SECRET_VALUE = 'SECRET-VALUE-' + 'q'.repeat(40);
const PAYLOAD_MARKER = 'PAYLOAD-MARKER-7f3a';
const URL_DESK = 'https://desk.example.test/v1/outbox';

const baseEnv = (over = {}) => ({
  TITAN_OUTBOX_DATABASE_URL: 'postgresql://publisher:pw@db.example.test/titan',
  TITAN_OUTBOX_ROUTES: JSON.stringify([{ consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], url: URL_DESK, secretEnv: 'TITAN_OUTBOX_SECRET_DESK' }]),
  TITAN_OUTBOX_SECRET_DESK: SECRET_VALUE,
  TITAN_OUTBOX_POLL_INTERVAL_MS: '200',
  TITAN_OUTBOX_SHUTDOWN_TIMEOUT_MS: '1000',
  ...over,
});

test('configuration names the variable on error and never echoes a value', () => {
  assert.throws(() => readOutboxWorkerConfig({ ...baseEnv(), TITAN_OUTBOX_DATABASE_URL: '' }), /TITAN_OUTBOX_DATABASE_URL must be set/);
  assert.throws(() => readOutboxWorkerConfig({ ...baseEnv(), TITAN_OUTBOX_BATCH_SIZE: '0' }), /TITAN_OUTBOX_BATCH_SIZE must be an integer from 1 to 500/);
  assert.throws(() => readOutboxWorkerConfig({ ...baseEnv(), TITAN_OUTBOX_POLL_INTERVAL_MS: '12x' }), /TITAN_OUTBOX_POLL_INTERVAL_MS/);
  assert.throws(() => readOutboxWorkerConfig({ ...baseEnv(), TITAN_OUTBOX_ROUTES: '[{bad json' }), /not valid JSON/);
  assert.throws(() => readOutboxWorkerConfig({ ...baseEnv(), TITAN_OUTBOX_SECRET_DESK: undefined }), /TITAN_OUTBOX_SECRET_DESK \(named by TITAN_OUTBOX_ROUTES\[0\]\) is not set/);
  assert.throws(() => readOutboxWorkerConfig({ ...baseEnv(), TITAN_OUTBOX_SECRET_DESK: 'short-secret-value' }), /too short|secret/);
});

test('an insecure consumer URL is refused at startup unless localhost and the development policy allow it', () => {
  const route = (url) => JSON.stringify([{ consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], url, secretEnv: 'TITAN_OUTBOX_SECRET_DESK' }]);
  assert.throws(() => readOutboxWorkerConfig(baseEnv({ TITAN_OUTBOX_ROUTES: route('http://desk.example.test/') })), /must use https/);
  assert.throws(() => readOutboxWorkerConfig(baseEnv({ TITAN_OUTBOX_ROUTES: route('http://localhost:3000/') })), /must use https/);
  const dev = readOutboxWorkerConfig(baseEnv({ TITAN_OUTBOX_ROUTES: route('http://localhost:3000/'), TITAN_ALLOW_INSECURE_LOCALHOST: '1' }));
  assert.equal(dev.allowInsecureLocalhost, true);
  assert.throws(() => readOutboxWorkerConfig(baseEnv({ TITAN_OUTBOX_ROUTES: route('http://desk.example.test/'), TITAN_ALLOW_INSECURE_LOCALHOST: '1' })), /must use https/);
});

test('a route takes either one secret or a rotation key list, each read from named variables', () => {
  const keyed = JSON.stringify([{ consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], url: URL_DESK, keys: [
    { id: 'previous', secretEnv: 'TITAN_OUTBOX_SECRET_OLD', notBefore: '2026-01-01T00:00:00Z', notAfter: '2026-02-01T00:00:00Z' },
    { id: 'current', secretEnv: 'TITAN_OUTBOX_SECRET_DESK', notBefore: '2026-01-20T00:00:00Z', notAfter: '2026-12-31T00:00:00Z' }] }]);
  const env = baseEnv({ TITAN_OUTBOX_ROUTES: keyed, TITAN_OUTBOX_SECRET_OLD: 'OLD-' + 'z'.repeat(40) });
  const [route] = readRouteConfig(env);
  assert.equal(route.keys.length, 2);
  assert.equal(route.keys[0].secret, env.TITAN_OUTBOX_SECRET_OLD);
  assert.throws(() => readRouteConfig(baseEnv({ TITAN_OUTBOX_ROUTES: JSON.stringify([{ consumer: 'x-inbox', organisationId: ORG_A, eventTypes: ['e'], url: URL_DESK, secretEnv: 'TITAN_OUTBOX_SECRET_DESK', keys: [] }]) })),
    /exactly one of secretEnv or keys/);
  assert.throws(() => readRouteConfig(baseEnv({ TITAN_OUTBOX_ROUTES: JSON.stringify([{ consumer: 'x-inbox', organisationId: 'not-a-uuid', eventTypes: ['e'], url: URL_DESK, secretEnv: 'TITAN_OUTBOX_SECRET_DESK' }]) })),
    /organisationId must be a UUID/);
});

test('the loop keeps running after a failed cycle, waits when idle, and logs only error codes', async () => {
  const controller = new AbortController();
  const logs = [];
  const sleeps = [];
  const script = [
    { claimed: 2, published: 2, failed: 0, dead: 0 },
    new Error('connect ECONNREFUSED postgres://publisher:pw@db.example.test/titan'),
    { claimed: 0, published: 0, failed: 0, dead: 0 },
  ];
  const publisher = { async runOnce() {
    const next = script.shift();
    if (next === undefined) { controller.abort(); return { claimed: 0, published: 0, failed: 0, dead: 0 }; }
    if (next instanceof Error) throw next;
    return next;
  } };
  const totals = await runOutboxLoop({ publisher, pollIntervalMs: 500, signal: controller.signal,
    log: (event, fields) => logs.push([event, fields]), sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(totals.cycleErrors, 1);
  assert.equal(totals.published, 2);
  assert.deepEqual(sleeps, [1000, 500, 500], 'backoff after the failure, poll interval when idle');
  const errorLog = logs.find(([event]) => event === 'outbox.cycle_error')[1];
  assert.equal(errorLog.code, 'Error');
  assert.doesNotMatch(JSON.stringify(logs), /postgres:|pw@/);
});

test('an abort interrupts the idle sleep at once instead of waiting for the poll interval', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const started = Date.now();
  await interruptibleSleep(60_000, controller.signal);
  assert.ok(Date.now() - started < 1000);
});

// Fake pool. The first claim returns the queued rows; later claims return nothing. Publishing is counted.
function fakeLoadPg(state) {
  class Pool {
    constructor(options) { state.poolOptions = options; }
    async connect() {
      return { release() {}, async query(text) {
        if (text.includes('WITH due AS')) { state.claims += 1; return { rows: state.queue.splice(0) }; }
        if (text.includes("SET status = 'published'")) { state.published += 1; return { rows: [{ id: 'x' }] }; }
        return { rows: [] };
      } };
    }
    async end() { state.ended = true; }
  }
  return async () => ({ Pool });
}
const claimedRow = () => ({ id: '11111111-1111-4111-8111-111111111111', organisation_id: ORG_A, source_product: 'desk', event_type: 'example',
  schema_version: 1, correlation_id: 'c', idempotency_key: 'k-1', payload: { note: PAYLOAD_MARKER }, attempts: 0, created_at: '2026-01-01T00:00:00Z' });
const newState = () => ({ queue: [claimedRow()], claims: 0, published: 0, ended: false, poolOptions: null });

test('SIGTERM lets the in-flight batch finish, starts no new claim, closes the pool and exits 0', async () => {
  const state = newState();
  const logs = [];
  const sent = [];
  let onFetchStarted;
  const fetchStarted = new Promise((resolve) => { onFetchStarted = resolve; });
  let releaseFetch;
  const fetch = (url, init) => new Promise((resolve) => {
    sent.push({ url, body: init.body });
    onFetchStarted();
    releaseFetch = () => resolve(new Response(null, { status: 204 }));
  });
  const proc = new EventEmitter();
  const done = runOutboxWorker({ env: baseEnv(), loadPg: fakeLoadPg(state), fetch, log: (e, f) => logs.push([e, f]), proc, sleep: interruptibleSleep });
  await fetchStarted;
  proc.emit('SIGTERM');
  releaseFetch();
  assert.equal(await done, 0);
  assert.equal(state.published, 1, 'the in-flight event was published');
  assert.equal(state.claims, 1, 'no claim after the signal');
  assert.equal(state.ended, true, 'pool closed');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, URL_DESK);
  assert.deepEqual(logs.map(([e]) => e), ['outbox.started', 'outbox.stopping', 'outbox.batch', 'outbox.stopped']);
  // Payloads and secrets appear only in the signed POST body. Logs never carry them.
  const logText = JSON.stringify(logs);
  assert.doesNotMatch(logText, new RegExp(PAYLOAD_MARKER));
  assert.doesNotMatch(logText, new RegExp(SECRET_VALUE));
  assert.doesNotMatch(logText, /https?:\/\/|postgresql:/);
  assert.match(sent[0].body, new RegExp(PAYLOAD_MARKER), 'the envelope itself carries the payload to the consumer');
});

test('a batch that does not finish by the shutdown deadline is abandoned: exit 1 and the pool is closed', async () => {
  const state = newState();
  const logs = [];
  const fetch = () => new Promise(() => {}); // never answers
  const proc = new EventEmitter();
  const done = runOutboxWorker({ env: baseEnv({ TITAN_OUTBOX_SHUTDOWN_TIMEOUT_MS: '1000' }), loadPg: fakeLoadPg(state), fetch,
    log: (e, f) => logs.push([e, f]), proc, sleep: interruptibleSleep });
  await new Promise((resolve) => setTimeout(resolve, 50));
  proc.emit('SIGTERM');
  assert.equal(await done, 1);
  assert.equal(state.ended, true);
  assert.ok(logs.some(([e]) => e === 'outbox.shutdown_timeout'));
});

test('a worker with invalid configuration does not connect to the database', async () => {
  let connected = false;
  await assert.rejects(runOutboxWorker({ env: baseEnv({ TITAN_OUTBOX_MAX_ATTEMPTS: '0' }), loadPg: async () => { connected = true; return { Pool: class {} }; }, fetch: async () => new Response(null, { status: 204 }), log: () => {}, proc: new EventEmitter() }),
    /TITAN_OUTBOX_MAX_ATTEMPTS/);
  assert.equal(connected, false);
});
