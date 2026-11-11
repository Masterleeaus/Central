import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionExchangeResolver, parseExchangeBody, SessionExchangeError, SESSION_EXCHANGE_PATH } from '../src/session-exchange.mjs';
import { loadConfig } from '../src/config.mjs';

const ORG = '0f9e8d7c-6b5a-4f3e-9d2c-1b0a99887766';
const TOKEN = 'fixture-access-token-0123456789abcdef';
const COOKIE = 'launcher_sid=browser-only-cookie-value';
const CENTRAL = 'https://central.example.test';

function fakeFetch(status, body, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return { status, json: async () => { if (body === 'not-json') throw new SyntaxError('bad'); return body; } };
  };
}
const req = (headers = {}) => ({ headers });

test('no cookie means signed out and no request is made', async () => {
  const calls = [];
  const resolve = createSessionExchangeResolver({ centralOrigin: CENTRAL, fetchImpl: fakeFetch(200, {}, calls) });
  assert.equal(await resolve(req()), null);
  assert.equal(calls.length, 0);
});

test('forwards only the browser cookie to the exchange path on the configured origin', async () => {
  const calls = [];
  const resolve = createSessionExchangeResolver({ centralOrigin: CENTRAL, fetchImpl: fakeFetch(200, { organisationId: ORG, accessToken: TOKEN }, calls) });
  await resolve(req({ cookie: COOKIE, authorization: 'Bearer should-not-forward-0123456789' }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${CENTRAL}${SESSION_EXCHANGE_PATH}`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['accept', 'cookie']);
  assert.equal(calls[0].init.headers.cookie, COOKIE);
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test('a complete 200 body yields the session and drops unknown fields', async () => {
  const resolve = createSessionExchangeResolver({
    centralOrigin: CENTRAL,
    fetchImpl: fakeFetch(200, { organisationId: ORG, accessToken: TOKEN, companyName: 'Acme Ltd', extra: 'ignored' }),
  });
  const session = await resolve(req({ cookie: COOKIE }));
  assert.deepEqual({ ...session }, { organisationId: ORG, accessToken: TOKEN, companyName: 'Acme Ltd' });
  assert.equal('extra' in session, false);
});

test('401 from the exchange is signed out, not an error', async () => {
  const resolve = createSessionExchangeResolver({ centralOrigin: CENTRAL, fetchImpl: fakeFetch(401, { error: 'unauthenticated' }) });
  assert.equal(await resolve(req({ cookie: COOKIE })), null);
});

test('other statuses throw with the status only, never the token', async () => {
  for (const status of [403, 404, 500, 503]) {
    const resolve = createSessionExchangeResolver({ centralOrigin: CENTRAL, fetchImpl: fakeFetch(status, { accessToken: TOKEN }) });
    await assert.rejects(resolve(req({ cookie: COOKIE })), (e) => {
      assert.ok(e instanceof SessionExchangeError);
      assert.equal(e.status, status);
      assert.equal(e.message.includes(TOKEN), false);
      return true;
    });
  }
});

test('a transport failure throws without echoing the cookie', async () => {
  const resolve = createSessionExchangeResolver({ centralOrigin: CENTRAL, fetchImpl: async () => { throw new Error(`socket ${COOKIE}`); } });
  await assert.rejects(resolve(req({ cookie: COOKIE })), (e) => {
    assert.equal(e.message, 'exchange_unreachable');
    assert.equal(e.message.includes(COOKIE), false);
    return true;
  });
});

test('a non-JSON 200 body is signed out', async () => {
  const resolve = createSessionExchangeResolver({ centralOrigin: CENTRAL, fetchImpl: fakeFetch(200, 'not-json') });
  assert.equal(await resolve(req({ cookie: COOKIE })), null);
});

test('malformed bodies are signed out (fail closed)', async () => {
  const bad = [
    null,
    [],
    'text',
    { organisationId: 'not-a-uuid', accessToken: TOKEN },
    { organisationId: ORG },
    { organisationId: ORG, accessToken: 'short' },
    { organisationId: ORG, accessToken: 'has spaces in it at all ok' },
    { organisationId: ORG, accessToken: TOKEN, companyName: '' },
    { organisationId: ORG, accessToken: TOKEN, companyName: 'x'.repeat(121) },
  ];
  for (const body of bad) {
    const resolve = createSessionExchangeResolver({ centralOrigin: CENTRAL, fetchImpl: fakeFetch(200, body) });
    assert.equal(await resolve(req({ cookie: COOKIE })), null, JSON.stringify(body));
  }
});

test('parseExchangeBody returns frozen values', () => {
  const session = parseExchangeBody({ organisationId: ORG, accessToken: TOKEN });
  assert.ok(Object.isFrozen(session));
  assert.equal(session.companyName, undefined);
});

test('centralOrigin is required', () => {
  assert.throws(() => createSessionExchangeResolver({}), TypeError);
});

test('config: sessionExchange defaults to off and must be a boolean', () => {
  const base = {
    centralOrigin: CENTRAL,
    products: [
      { id: 'sorted', legacyApplication: 'field', displayName: 'Sorted', url: 'https://sorted.example.test' },
      { id: 'supercharged', legacyApplication: 'desk', displayName: 'Supercharged', url: 'https://supercharged.example.test' },
      { id: 'lms', legacyApplication: 'academy', displayName: 'LMS', url: 'https://lms.example.test' },
    ],
  };
  assert.equal(loadConfig(base).sessionExchange, false);
  assert.equal(loadConfig({ ...base, sessionExchange: true }).sessionExchange, true);
  assert.throws(() => loadConfig({ ...base, sessionExchange: 'yes' }), /sessionExchange must be true or false/);
});
