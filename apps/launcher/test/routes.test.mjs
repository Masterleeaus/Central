import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';
import { CENTRAL, SESSION, ALLOW, DENY, fakeCentral, startLauncher, testConfig } from './helpers.mjs';

const SIGN_IN_HREF = `${CENTRAL}/auth/titan/desk/start`;

async function get(origin, path, options = {}) {
  const res = await fetch(`${origin}${path}`, { redirect: 'manual', ...options });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const productLinks = (html) => [...html.matchAll(/<a class="button" href="([^"]+)">Open ([^<]+)<\/a>/g)].map((m) => ({ href: m[1], name: m[2] }));

/** Starts a launcher with a fake Central and a session. Returns helpers for assertions. */
async function harness({ session = SESSION, decisions, config = testConfig(), resolveSession } = {}) {
  const central = fakeCentral(decisions ?? { field: ALLOW, desk: DENY, academy: [503, { error: 'access_unavailable' }] });
  const launcher = await startLauncher({
    config,
    resolveSession: resolveSession ?? (async () => session),
    fetchImpl: central.fetchImpl,
  });
  return { ...launcher, calls: central.calls };
}

test('healthz returns ok without touching Central', async () => {
  const h = await harness();
  try {
    const res = await get(h.origin, '/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { status: 'ok' });
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test('signed out: shows a sign-in link to the existing control-api start route and no product links', async () => {
  const h = await harness({ session: null });
  try {
    const res = await get(h.origin, '/');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(`href="${SIGN_IN_HREF}"`));
    assert.deepEqual(productLinks(res.text), []);
    assert.equal(h.calls.length, 0, 'no access checks without a session');
  } finally { await h.close(); }
});

test('sign-in is explicitly unavailable when no launcher application is configured', async () => {
  const config = testConfig({ signIn: { applicationId: null } });
  const h = await harness({ session: null, config });
  try {
    const res = await get(h.origin, '/');
    assert.ok(res.text.includes('Sign-in is not configured'));
    assert.ok(!res.text.includes('/auth/titan/'));
  } finally { await h.close(); }
});

test('signed in: calls Central for each product with the session organisation and renders only allowed links', async () => {
  const h = await harness();
  try {
    const res = await get(h.origin, '/');
    assert.equal(res.status, 200);
    assert.equal(h.calls.length, 3);
    assert.deepEqual(productLinks(res.text), [{ href: 'https://sorted.example.test/', name: 'Sorted' }]);
    assert.ok(res.text.includes('Access granted.'));
    assert.ok(res.text.includes('Access denied for this company.'));
    assert.ok(res.text.includes('Status unavailable. Try again later.'));
  } finally { await h.close(); }
});

test('denied and unavailable products render a clear state and no destination link', async () => {
  const h = await harness({ decisions: { field: DENY, desk: DENY, academy: DENY } });
  try {
    const res = await get(h.origin, '/');
    assert.deepEqual(productLinks(res.text), []);
    assert.equal((res.text.match(/Access denied for this company\./g) ?? []).length, 3);
  } finally { await h.close(); }
});

test('the client cannot choose the organisation or product: query parameters are ignored', async () => {
  const h = await harness();
  try {
    await get(h.origin, `/?organisation_id=99999999-9999-4999-8999-999999999999&application=desk&action=admin:all`);
    for (const { url } of h.calls) {
      assert.equal(url.searchParams.get('organisation_id'), SESSION.organisationId);
      assert.equal(url.searchParams.get('action'), 'session:open');
    }
  } finally { await h.close(); }
});

test('an expired session (401 from Central) returns the signed-out page with a message and no links', async () => {
  const h = await harness({ decisions: { field: [401, { error: 'unauthenticated' }], desk: [401, {}], academy: [401, {}] } });
  try {
    const res = await get(h.origin, '/');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Your session has ended. Sign in again.'));
    assert.ok(res.text.includes(`href="${SIGN_IN_HREF}"`));
    assert.deepEqual(productLinks(res.text), []);
  } finally { await h.close(); }
});

test('the access token is never rendered into the page', async () => {
  const h = await harness({ decisions: { field: ALLOW, desk: ALLOW, academy: ALLOW } });
  try {
    const res = await get(h.origin, '/');
    assert.ok(!res.text.includes(SESSION.accessToken));
    assert.ok(!res.text.includes(SESSION.organisationId));
  } finally { await h.close(); }
});

test('a session resolver that throws fails closed to the signed-out page', async () => {
  const h = await harness({ resolveSession: async () => { throw new Error('boom'); } });
  try {
    const res = await get(h.origin, '/');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Sign in to Titan Central'));
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test('a session missing an access token is treated as signed out', async () => {
  const h = await harness({ session: { organisationId: SESSION.organisationId } });
  try {
    const res = await get(h.origin, '/');
    assert.ok(res.text.includes('Sign in to Titan Central'));
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test('a Central network failure degrades product status without failing the page', async () => {
  const h = await harness({ decisions: { field: new Error('ECONNRESET'), desk: ALLOW, academy: ALLOW } });
  try {
    const res = await get(h.origin, '/');
    assert.equal(res.status, 200);
    assert.deepEqual(productLinks(res.text).map((l) => l.name), ['Supercharged', 'LMS']);
    assert.ok(res.text.includes('Status unavailable. Try again later.'));
  } finally { await h.close(); }
});

test('company name is escaped', async () => {
  const h = await harness({ session: { ...SESSION, companyName: '<img src=x onerror=alert(1)>' } });
  try {
    const res = await get(h.origin, '/');
    assert.ok(!res.text.includes('<img src=x'));
    assert.ok(res.text.includes('&lt;img src=x'));
  } finally { await h.close(); }
});

test('company switch is a link only when configured, and goes to the configured organisation-selection URL', async () => {
  const unconfigured = await harness();
  try {
    const res = await get(unconfigured.origin, '/');
    assert.ok(res.text.includes('Company switching is not available yet.'));
    assert.ok(!res.text.includes('Switch company'));
  } finally { await unconfigured.close(); }

  const config = testConfig({ organisationSwitch: { url: 'https://central.test/organisations/select' } });
  const configured = await harness({ config });
  try {
    const res = await get(configured.origin, '/');
    assert.ok(res.text.includes('<a href="https://central.test/organisations/select">Switch company</a>'));
  } finally { await configured.close(); }
});

test('unknown paths return 404 and non-GET methods are refused', async () => {
  const h = await harness();
  try {
    assert.equal((await get(h.origin, '/anything')).status, 404);
    assert.equal((await get(h.origin, '/auth/titan/desk/start')).status, 404, 'the launcher does not implement OIDC itself');
    const post = await get(h.origin, '/', { method: 'POST', body: 'x' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');
  } finally { await h.close(); }
});

test('HTML responses carry no-store, nosniff, a CSP and frame denial', async () => {
  const h = await harness();
  try {
    const res = await get(h.origin, '/');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(res.headers.get('content-type'), /^text\/html/);
  } finally { await h.close(); }
});

test('the stylesheet is served from the same origin with a text/css type', async () => {
  const h = await harness();
  try {
    const res = await get(h.origin, '/assets/launcher.css');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/css/);
    assert.ok(res.text.includes('prefers-color-scheme: dark'));
  } finally { await h.close(); }
});

test('the page has a viewport meta tag and links the same-origin stylesheet', async () => {
  const h = await harness();
  try {
    const res = await get(h.origin, '/');
    assert.ok(res.text.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
    assert.ok(res.text.includes('<link rel="stylesheet" href="/assets/launcher.css">'));
  } finally { await h.close(); }
});

test('a config built with loadConfig is what the handler uses for destinations', async () => {
  const config = loadConfig({ ...testConfig(), products: testConfig().products.map((p) => ({ ...p, url: `https://${p.id}.custom.test` })) });
  const h = await harness({ config, decisions: { field: ALLOW, desk: ALLOW, academy: ALLOW } });
  try {
    const res = await get(h.origin, '/');
    assert.deepEqual(productLinks(res.text).map((l) => l.href), ['https://sorted.custom.test/', 'https://supercharged.custom.test/', 'https://lms.custom.test/']);
  } finally { await h.close(); }
});
