import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProductAccess, ACCESS_ACTION } from '../src/access.mjs';
import { SESSION, CENTRAL, fakeCentral, testConfig } from './helpers.mjs';

const product = (id) => testConfig().products.find((p) => p.id === id);
const run = (fetchImpl, productId = 'sorted') => checkProductAccess({
  fetchImpl, centralOrigin: CENTRAL, session: SESSION, product: product(productId), timeoutMs: 2000,
});

test('sends organisation, legacy application, action and bearer token to the Central access check', async () => {
  const { fetchImpl, calls } = fakeCentral({ field: [200, { allowed: true, role: 'owner', reason: 'allowed' }] });
  await run(fetchImpl, 'sorted');
  const [call] = calls;
  assert.equal(call.url.origin, CENTRAL);
  assert.equal(call.url.pathname, '/v1/access/check');
  assert.equal(call.url.searchParams.get('organisation_id'), SESSION.organisationId);
  assert.equal(call.url.searchParams.get('application'), 'field');
  assert.equal(call.url.searchParams.get('action'), ACCESS_ACTION);
  assert.equal(call.init.headers.authorization, `Bearer ${SESSION.accessToken}`);
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.method, 'GET');
});

test('HTTP 200 with allowed true is available', async () => {
  const { fetchImpl } = fakeCentral({ field: [200, { allowed: true, role: 'member', reason: 'allowed' }] });
  assert.deepEqual({ ...(await run(fetchImpl, 'sorted')) }, { state: 'available', reason: 'allowed' });
});

test('HTTP 403 with allowed false is denied, carrying the sanitised reason code', async () => {
  const { fetchImpl } = fakeCentral({ desk: [403, { allowed: false, role: null, reason: 'not_entitled' }] });
  assert.deepEqual({ ...(await run(fetchImpl, 'supercharged')) }, { state: 'denied', reason: 'not_entitled' });
});

test('an unsafe reason string from Central is replaced by the generic denied code', async () => {
  const { fetchImpl } = fakeCentral({ desk: [403, { allowed: false, reason: '<script>x</script>' }] });
  assert.equal((await run(fetchImpl, 'supercharged')).reason, 'denied');
});

test('HTTP 401 is expired', async () => {
  const { fetchImpl } = fakeCentral({ academy: [401, { error: 'unauthenticated' }] });
  assert.equal((await run(fetchImpl, 'lms')).state, 'expired');
});

test('a 200 that does not say allowed === true strictly is unavailable, never available', async () => {
  for (const body of [{ allowed: 'true' }, { allowed: 1 }, {}, [], 'true', null]) {
    const { fetchImpl } = fakeCentral({ field: [200, body] });
    assert.equal((await run(fetchImpl, 'sorted')).state, 'unavailable', `body ${JSON.stringify(body)}`);
  }
});

test('a 403 that says allowed true is unavailable (inconsistent response fails closed)', async () => {
  const { fetchImpl } = fakeCentral({ field: [403, { allowed: true }] });
  assert.equal((await run(fetchImpl, 'sorted')).state, 'unavailable');
});

test('non-JSON 200 is unavailable', async () => {
  const { fetchImpl } = fakeCentral({ field: [200, '<html>proxy page</html>'] });
  assert.equal((await run(fetchImpl, 'sorted')).state, 'unavailable');
});

test('503 and 429 are unavailable', async () => {
  for (const status of [503, 429, 500]) {
    const { fetchImpl } = fakeCentral({ field: [status, { error: 'access_unavailable' }] });
    assert.deepEqual({ ...(await run(fetchImpl, 'sorted')) }, { state: 'unavailable', reason: `http_${status}` });
  }
});

test('a network error or timeout is unavailable and does not throw', async () => {
  const { fetchImpl } = fakeCentral({ field: new Error('socket hang up') });
  assert.deepEqual({ ...(await run(fetchImpl, 'sorted')) }, { state: 'unavailable', reason: 'network_error' });
});

test('the access token is never part of the returned result', async () => {
  const { fetchImpl } = fakeCentral({ field: [200, { allowed: true }] });
  const result = await run(fetchImpl, 'sorted');
  assert.ok(!JSON.stringify(result).includes(SESSION.accessToken));
});
