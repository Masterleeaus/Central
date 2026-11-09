import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_DEFINITIONS,
  buildProductRegistry,
  resolveProduct,
  probeProduct,
  PROBE_PATHS,
} from '../dist/index.js';

const SORTED = 'https://sorted.titanzero.io';
const registry = (serviceOrigins = { sorted: SORTED }) =>
  buildProductRegistry({ serviceOrigins, trustedOrigins: [SORTED, 'https://supercharged.titanzero.io', 'https://lms.titanzero.io'] });
const sorted = () => resolveProduct(registry(), 'sorted');
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const GOOD_VERSION = { contractVersion: '0.1.0-draft', capabilities: ['health', 'version', 'tenant-link:verify', 'jobs:read', 'visits:read'] };

/** Fake fetch: routes by path, records every call, never touches the network. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const route = routes[new URL(url).pathname];
    if (typeof route === 'function') return route(init);
    return route ?? json(404, {});
  };
  return { fetch, calls };
}

test('healthy product: both checks pass and the request is a bare GET with redirects disabled', async () => {
  const { fetch, calls } = fakeFetch({ [PROBE_PATHS.health]: json(200, { status: 'ok' }), [PROBE_PATHS.version]: json(200, GOOD_VERSION) });
  const result = await probeProduct(sorted(), { fetch });
  assert.equal(result.healthy, true);
  assert.deepEqual(result.health, { ok: true });
  assert.equal(result.version.contractVersion, '0.1.0-draft');
  assert.deepEqual(calls.map((c) => c.url).sort(), [`${SORTED}${PROBE_PATHS.health}`, `${SORTED}${PROBE_PATHS.version}`].sort());
  for (const c of calls) {
    assert.equal(c.init.method, 'GET');
    assert.equal(c.init.redirect, 'manual');
    assert.equal(c.init.headers.authorization, undefined);
    assert.equal(c.init.headers.cookie, undefined);
  }
});

test('a product with no validated origin is never fetched and reports unhealthy', async () => {
  const { fetch, calls } = fakeFetch({});
  const product = resolveProduct(registry({}), 'sorted');
  const result = await probeProduct(product, { fetch });
  assert.equal(result.healthy, false);
  assert.equal(result.health.reason, 'not_configured');
  assert.equal(calls.length, 0);
});

test('redirects are reported and not followed', async () => {
  const { fetch } = fakeFetch({
    [PROBE_PATHS.health]: new Response(null, { status: 302, headers: { location: 'https://evil.example.test/' } }),
    [PROBE_PATHS.version]: json(200, GOOD_VERSION),
  });
  const result = await probeProduct(sorted(), { fetch });
  assert.equal(result.health.reason, 'redirect');
  assert.equal(result.healthy, false);
});

test('non-200 status, invalid JSON, and health not ok are unhealthy with reason codes', async () => {
  const cases = [
    [json(500, { status: 'ok' }), 'http_status'],
    [new Response('not json', { status: 200 }), 'invalid_body'],
    [json(200, { status: 'degraded' }), 'health_not_ok'],
    [json(200, ['ok']), 'invalid_body'],
  ];
  for (const [response, reason] of cases) {
    const { fetch } = fakeFetch({ [PROBE_PATHS.health]: response, [PROBE_PATHS.version]: json(200, GOOD_VERSION) });
    const result = await probeProduct(sorted(), { fetch });
    assert.equal(result.health.reason, reason);
    assert.equal(result.healthy, false);
  }
});

test('a body larger than the cap is refused and the stream is cancelled', async () => {
  let cancelled = false;
  const big = { status: 200, body: { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array(3000) }),
    cancel: async () => { cancelled = true; },
  }) } };
  const { fetch } = fakeFetch({ [PROBE_PATHS.health]: async () => big, [PROBE_PATHS.version]: json(200, GOOD_VERSION) });
  const result = await probeProduct(sorted(), { fetch, maxBodyBytes: 4096 });
  assert.equal(result.health.reason, 'body_too_large');
  assert.equal(cancelled, true);
});

test('a hanging request times out and reports unhealthy, even when fetch ignores the signal', async () => {
  const hang = () => new Promise(() => {});
  const { fetch } = fakeFetch({ [PROBE_PATHS.health]: hang, [PROBE_PATHS.version]: json(200, GOOD_VERSION) });
  const started = Date.now();
  const result = await probeProduct(sorted(), { fetch, timeoutMs: 30 });
  assert.equal(result.health.reason, 'timeout');
  assert.ok(Date.now() - started < 2000);
});

test('network errors are reported as reason codes without the error message', async () => {
  const { fetch } = fakeFetch({
    [PROBE_PATHS.health]: async () => { throw new Error('getaddrinfo ENOTFOUND sorted.titanzero.io secret-detail'); },
    [PROBE_PATHS.version]: json(200, GOOD_VERSION),
  });
  const result = await probeProduct(sorted(), { fetch });
  assert.equal(result.health.reason, 'network_error');
  assert.ok(!JSON.stringify(result).includes('secret-detail'));
});

test('a version that reports an undeclared or mismatched contract is incompatible and unhealthy', async () => {
  const { fetch } = fakeFetch({
    [PROBE_PATHS.health]: json(200, { status: 'ok' }),
    [PROBE_PATHS.version]: json(200, { contractVersion: '9.9.9-draft', capabilities: ['health', 'version', 'tenant-link:verify', 'jobs:read', 'visits:read'] }),
  });
  const result = await probeProduct(sorted(), { fetch });
  assert.equal(result.health.ok, true);
  assert.equal(result.version.reason, 'contract_incompatible');
  assert.equal(result.healthy, false);
  assert.equal(result.version.inspection.findings[0].code, 'contract_version_mismatch');
});

test('a probe failure never changes the registry it was given', async () => {
  const reg = registry();
  const before = structuredClone(reg);
  const { fetch } = fakeFetch({});
  await probeProduct(resolveProduct(reg, 'sorted'), { fetch });
  assert.deepEqual(reg, before);
});

test('probe results are reported separately and carry no access-relevant fields', async () => {
  const { fetch } = fakeFetch({ [PROBE_PATHS.health]: json(200, { status: 'ok' }), [PROBE_PATHS.version]: json(200, GOOD_VERSION) });
  const result = await probeProduct(sorted(), { fetch });
  assert.deepEqual(Object.keys(result).sort(), ['health', 'healthy', 'productId', 'version']);
  assert.equal('accessGranted' in result, false);
  assert.equal('allowed' in result, false);
});

test('definitions used by the probe are still the canonical set', () => {
  assert.deepEqual(PRODUCT_DEFINITIONS.map((p) => p.id), ['sorted', 'supercharged', 'lms']);
});
