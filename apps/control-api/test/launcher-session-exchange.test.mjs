import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncherSessionExchange, validLauncherSession } from '../src/launcher-session-exchange.mjs';
import { createCentralHandler } from '../src/app.mjs';

const ORG = '0f9e8d7c-6b5a-4f3e-9d2c-1b0a99887766';
const TOKEN = 'fixture-access-token-0123456789abcdef';

function fakeReq(url = '/v1/launcher/session', method = 'GET', headers = {}) {
  return { url, method, headers, socket: { remoteAddress: '127.0.0.1' } };
}
function fakeRes() {
  const res = { status: null, headers: null, body: '', headersSent: false };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; res.headersSent = true; };
  res.end = (body = '') => { res.body = body; };
  return res;
}

test('signed-out browser gets 401 and no token', async () => {
  const handler = createLauncherSessionExchange({ loadSession: async () => null });
  const res = fakeRes();
  assert.equal(await handler(fakeReq(), res), true);
  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(res.body), { error: 'unauthenticated' });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('signed-in browser gets the organisation and token, with no-store headers', async () => {
  const handler = createLauncherSessionExchange({ loadSession: async () => ({ organisationId: ORG, accessToken: TOKEN, companyName: 'Acme Ltd' }) });
  const res = fakeRes();
  assert.equal(await handler(fakeReq(), res), true);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { organisationId: ORG, accessToken: TOKEN, companyName: 'Acme Ltd' });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('an incomplete or malformed session fails closed with 401', async () => {
  for (const session of [{ organisationId: ORG }, { accessToken: TOKEN }, { organisationId: 'nope', accessToken: TOKEN }, 'string', 42]) {
    const handler = createLauncherSessionExchange({ loadSession: async () => session });
    const res = fakeRes();
    await handler(fakeReq(), res);
    assert.equal(res.status, 401, JSON.stringify(session));
    assert.equal(res.body.includes(TOKEN), false);
  }
});

test('a loader failure answers 503 and logs only the error class', async () => {
  const events = [];
  const handler = createLauncherSessionExchange({
    loadSession: async () => { const e = new Error(`db down ${TOKEN}`); e.name = 'PoolError'; throw e; },
    logger: (event, fields) => events.push({ event, fields }),
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.status, 503);
  assert.deepEqual(JSON.parse(res.body), { error: 'session_unavailable' });
  assert.deepEqual(events, [{ event: 'launcher_session_unavailable', fields: { error_class: 'PoolError' } }]);
  assert.equal(JSON.stringify(events).includes(TOKEN), false);
});

test('a broken logger never changes the response', async () => {
  const handler = createLauncherSessionExchange({
    loadSession: async () => null,
    logger: () => { throw new Error('log sink down'); },
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.status, 401);
});

test('other paths are not handled and the loader is not called', async () => {
  let called = false;
  const handler = createLauncherSessionExchange({ loadSession: async () => { called = true; return null; } });
  assert.equal(await handler(fakeReq('/v1/access/check'), fakeRes()), false);
  assert.equal(await handler(fakeReq('/v1/launcher/session/extra'), fakeRes()), false);
  assert.equal(called, false);
});

test('non-GET methods are refused', async () => {
  const handler = createLauncherSessionExchange({ loadSession: async () => null });
  const res = fakeRes();
  assert.equal(await handler(fakeReq('/v1/launcher/session', 'POST'), res), true);
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'GET');
});

test('validLauncherSession enforces the shape and freezes the result', () => {
  assert.equal(validLauncherSession({ organisationId: ORG, accessToken: 'short' }), null);
  assert.equal(validLauncherSession({ organisationId: ORG, accessToken: TOKEN, companyName: '' }), null);
  assert.equal(validLauncherSession({ organisationId: ORG, accessToken: TOKEN, companyName: 'x'.repeat(121) }), null);
  const session = validLauncherSession({ organisationId: ORG, accessToken: TOKEN, extra: 'dropped' });
  assert.ok(Object.isFrozen(session));
  assert.equal('extra' in session, false);
});

test('mounted on the central handler, the route answers and other routes are unchanged', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const central = createCentralHandler({
    pool,
    verifyToken: async () => { throw new Error('unused'); },
    issuer: 'https://issuer.example.test',
    audiences: { field: 'aud-field', desk: 'aud-desk', academy: 'aud-academy' },
    launcherSessionHandler: createLauncherSessionExchange({ loadSession: async () => null }),
  });
  const res = fakeRes();
  await central(fakeReq('/v1/launcher/session'), res);
  assert.equal(res.status, 401);
});

test('without the handler mounted, the route is 404 as before', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const central = createCentralHandler({
    pool,
    verifyToken: async () => { throw new Error('unused'); },
    issuer: 'https://issuer.example.test',
    audiences: { field: 'aud-field', desk: 'aud-desk', academy: 'aud-academy' },
  });
  const res = fakeRes();
  await central(fakeReq('/v1/launcher/session'), res);
  assert.equal(res.status, 404);
});
