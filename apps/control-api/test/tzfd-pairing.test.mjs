import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  createTzfdPairingHandler, mintPairingCode, pairingCodeDigest, readTzfdPairingConfig,
  TZFD_PAIR_PATH, TZFD_PAIR_CONTRACT,
} from '../src/tzfd-pairing-handler.mjs';
import { createRateLimiter } from '../src/rate-limit.mjs';

const SITE = 'site-0123456789abcdef01234567';
const NONCE = '0123456789abcdef0123456789abcdef';
const CODE = 'ABCDEFGH-1234-JKLM';
const FEATURE = 'https://superchargedat.work/api/tzfd/ai';
const NOW = 1_800_000_000_000;
const COMPANY = '6f1c2e0a-9b8d-4c3e-8f7a-1b2c3d4e5f60';

function fakeRes() {
  const res = { status: null, headers: null, body: null };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.end = (body) => { res.body = body; };
  res.json = () => JSON.parse(res.body);
  return res;
}

function fakeReq({ method = 'POST', url = TZFD_PAIR_PATH, headers = {}, body, ip = '203.0.113.7' } = {}) {
  const payload = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  const req = Readable.from(payload === '' ? [] : [Buffer.from(payload)]);
  req.method = method;
  req.url = url;
  req.headers = {
    'x-tzfd-contract': TZFD_PAIR_CONTRACT,
    'x-tzfd-site': SITE,
    'x-tzfd-nonce': NONCE,
    'x-tzfd-timestamp': String(Math.floor(NOW / 1000)),
    ...headers,
  };
  req.socket = { remoteAddress: ip };
  return req;
}

function goodBody(overrides = {}) {
  return { contract: TZFD_PAIR_CONTRACT, site: SITE, pairing_code: CODE, ...overrides };
}

/** In-memory stand-in for the atomic store: one unused code, refused codes leave nothing behind. */
function makeStore({ companyUuid = COMPANY, consumeOnce = true, failure = null } = {}) {
  const calls = { pair: [] };
  let used = false;
  return {
    calls,
    async pair(args) {
      calls.pair.push(args);
      if (failure) throw failure;
      if (args.codeDigest !== pairingCodeDigest(CODE)) return null;
      if (consumeOnce && used) return null;
      used = true;
      return { companyUuid };
    },
  };
}

function makeHandler(overrides = {}) {
  const logs = [];
  const store = overrides.store ?? makeStore();
  const handler = createTzfdPairingHandler({
    store,
    featureEndpoint: FEATURE,
    clock: () => NOW,
    secretFactory: () => 'a'.repeat(64),
    logger: (event, fields) => logs.push({ event, fields }),
    ...overrides,
  });
  return { handler, store, logs };
}

test('other paths are not handled and produce no response', async () => {
  const { handler } = makeHandler();
  const res = fakeRes();
  assert.equal(await handler(fakeReq({ url: '/api/other' }), res), false);
  assert.equal(res.status, null);
});

test('query strings on the pairing path are refused as invalid', async () => {
  const { handler, store } = makeHandler();
  const res = fakeRes();
  assert.equal(await handler(fakeReq({ url: `${TZFD_PAIR_PATH}?x=1`, body: goodBody() }), res), true);
  assert.equal(res.status, 400);
  assert.equal(store.calls.pair.length, 0);
});

test('GET is refused with 405', async () => {
  const { handler } = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET' }), res);
  assert.equal(res.status, 405);
});

test('a valid pairing returns the secret once, the feature endpoint, and echoes the nonce', async () => {
  const { handler, store } = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ body: goodBody() }), res);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), {
    contract: TZFD_PAIR_CONTRACT,
    site: SITE,
    status: 'paired',
    secret: 'a'.repeat(64),
    feature_endpoint: FEATURE,
  });
  assert.equal(res.headers['x-tzfd-nonce'], NONCE);
  assert.equal(store.calls.pair.length, 1);
  assert.equal(store.calls.pair[0].siteId, SITE);
  assert.equal(store.calls.pair[0].secret, 'a'.repeat(64));
  assert.equal(store.calls.pair[0].codeDigest, pairingCodeDigest(CODE));
});

test('the store only ever sees the code digest, never the code', async () => {
  const { handler, store } = makeHandler();
  await handler(fakeReq({ body: goodBody() }), fakeRes());
  assert.notEqual(store.calls.pair[0].codeDigest, CODE);
  assert.equal(JSON.stringify(store.calls).includes(CODE), false);
});

test('a code is single use: the second attempt is code_rejected', async () => {
  const { handler } = makeHandler();
  await handler(fakeReq({ body: goodBody() }), fakeRes());
  const res = fakeRes();
  await handler(fakeReq({ body: goodBody() }), res);
  assert.equal(res.status, 403);
  assert.deepEqual(res.json(), { status: 'code_rejected' });
});

test('an unknown code is code_rejected', async () => {
  const { handler } = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ body: goodBody({ pairing_code: 'WRONG-CODE-000000' }) }), res);
  assert.equal(res.status, 403);
  assert.deepEqual(res.json(), { status: 'code_rejected' });
});

test('a wrong contract, a bad site or nonce header, or a malformed body is invalid_request with no store call', async () => {
  const cases = [
    { headers: { 'x-tzfd-contract': 'tzfd-pair/2' } },
    { headers: { 'x-tzfd-site': 'site-short' } },
    { headers: { 'x-tzfd-nonce': 'not-hex' } },
    { body: goodBody({ site: 'site-ffffffffffffffffffffffff' }) },
    { body: goodBody({ contract: 'central-pairing/1' }) },
    { body: goodBody({ pairing_code: 'short' }) },
    { body: goodBody({ pairing_code: 'has space in it 12345' }) },
    { body: '{not json' },
    { body: '' },
  ];
  for (const c of cases) {
    const { handler, store } = makeHandler();
    const res = fakeRes();
    await handler(fakeReq({ headers: c.headers, body: c.body ?? goodBody() }), res);
    assert.equal(res.status, 400, JSON.stringify(c));
    assert.deepEqual(res.json(), { status: 'invalid_request' });
    assert.equal(store.calls.pair.length, 0, JSON.stringify(c));
  }
});

test('a timestamp outside the 300-second window is refused', async () => {
  const { handler, store } = makeHandler();
  for (const offset of [-301, 301]) {
    const res = fakeRes();
    await handler(fakeReq({ headers: { 'x-tzfd-timestamp': String(Math.floor(NOW / 1000) + offset) }, body: goodBody() }), res);
    assert.equal(res.status, 400, `offset ${offset}`);
  }
  assert.equal(store.calls.pair.length, 0);
});

test('a body over 1024 bytes is refused', async () => {
  const { handler, store } = makeHandler();
  const res = fakeRes();
  await handler(fakeReq({ body: 'x'.repeat(2000) }), res);
  assert.equal(res.status, 400);
  assert.equal(store.calls.pair.length, 0);
});

test('a storage failure is service_error, does not pair, and never returns the secret', async () => {
  const { handler, logs } = makeHandler({ store: makeStore({ failure: new Error('db down') }) });
  const res = fakeRes();
  await handler(fakeReq({ body: goodBody() }), res);
  assert.equal(res.status, 503);
  assert.deepEqual(res.json(), { status: 'service_error' });
  assert.equal(res.body.includes('a'.repeat(64)), false);
  assert.equal(logs.at(-1).event, 'tzfd_pair_failed');
});

test('the rate limit answers 503 with retry-after once the window is used up', async () => {
  const rateLimiter = createRateLimiter({ limit: 1, windowMs: 60_000, clock: () => NOW });
  const { handler } = makeHandler({ rateLimiter, store: makeStore({ consumeOnce: false }) });
  await handler(fakeReq({ body: goodBody() }), fakeRes());
  const res = fakeRes();
  await handler(fakeReq({ body: goodBody() }), res);
  assert.equal(res.status, 503);
  assert.deepEqual(res.json(), { status: 'service_error' });
  assert.ok(Number(res.headers['retry-after']) >= 1);
});

test('logs record events but never the code, the secret or the body', async () => {
  const { handler, logs } = makeHandler();
  await handler(fakeReq({ body: goodBody() }), fakeRes());
  await handler(fakeReq({ body: goodBody() }), fakeRes());
  const text = JSON.stringify(logs);
  assert.ok(logs.some((l) => l.event === 'tzfd_pair_ok'));
  assert.ok(logs.some((l) => l.event === 'tzfd_pair_code_rejected'));
  assert.equal(text.includes(CODE), false);
  assert.equal(text.includes('a'.repeat(64)), false);
});

test('a feature endpoint off the allowlist or not https is refused at startup', () => {
  const store = makeStore();
  assert.throws(() => createTzfdPairingHandler({ store, featureEndpoint: 'https://evil.example.test/ai' }), TypeError);
  assert.throws(() => createTzfdPairingHandler({ store, featureEndpoint: 'https://api.superchargedat.work/ai' }), TypeError);
  assert.throws(() => createTzfdPairingHandler({ store, featureEndpoint: 'http://superchargedat.work/ai' }), TypeError);
  assert.throws(() => createTzfdPairingHandler({ store, featureEndpoint: 'https://u:p@superchargedat.work/ai' }), TypeError);
  assert.throws(() => createTzfdPairingHandler({ store, featureEndpoint: 'not a url' }), TypeError);
});

test('a store without the pair method is refused at startup', () => {
  assert.throws(() => createTzfdPairingHandler({ store: {}, featureEndpoint: FEATURE }), TypeError);
  assert.throws(() => createTzfdPairingHandler({ featureEndpoint: FEATURE }), TypeError);
});

test('minted codes are valid, unique, and match their digest', () => {
  const a = mintPairingCode();
  const b = mintPairingCode();
  assert.match(a.code, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(a.digest, pairingCodeDigest(a.code));
  assert.notEqual(a.code, b.code);
  assert.equal(a.code.includes(a.digest), false);
});

test('readTzfdPairingConfig is off without an endpoint and validates the one it reads', () => {
  assert.equal(readTzfdPairingConfig({}), null);
  assert.equal(readTzfdPairingConfig({ TZFD_PAIR_FEATURE_ENDPOINT: '' }), null);
  assert.deepEqual(readTzfdPairingConfig({ TZFD_PAIR_FEATURE_ENDPOINT: FEATURE }), {
    featureEndpoint: FEATURE,
    allowedFeatureHosts: ['superchargedat.work'],
  });
  assert.throws(() => readTzfdPairingConfig({ TZFD_PAIR_FEATURE_ENDPOINT: 'https://evil.example.test/ai' }), TypeError);
  assert.deepEqual(
    readTzfdPairingConfig({ TZFD_PAIR_FEATURE_ENDPOINT: 'https://ai.example.test/x', TZFD_PAIR_FEATURE_HOSTS: 'AI.example.test, other.example.test' }).allowedFeatureHosts,
    ['AI.example.test', 'other.example.test'],
  );
});
