import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createFlagRegistry } from '../../../packages/control-plane/dist/index.js';
import { createAdminHandler, createLogtoOperatorAuthoriser } from '../src/admin.mjs';
import { createFlagChangeHandler, parseFlagChange, FLAG_CHANGE_PATH } from '../src/config-admin.mjs';
import { createOperatorAdmin, readFlagChangeSetting } from '../src/operator-config.mjs';
import { createMetrics } from '../src/metrics.mjs';
import { memoryFlagStore, seedRow } from './support/flag-memory-store.mjs';

const ORIGINS = { field: 'https://field.titanzero.io', desk: 'https://desk.titanzero.io', academy: 'https://academy.titanzero.io' };
const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const OPERATOR = 'op-admin';
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

const registry = createFlagRegistry([
  { product: 'sorted', key: 'bulk_export', owner: 'sorted-team', spec: { type: 'boolean' }, default: false },
]);

/** Admin handler wired the way the server wires it: operator authority, then the flag change. */
function harness({ authoriseOperator = async p => p.logtoSubject === OPERATOR, store = memoryFlagStore() } = {}) {
  const handler = createAdminHandler({
    verifyToken: async token => {
      if (!/^tok-/.test(token)) throw new Error('bad token');
      return { logtoSubject: token.slice(4) };
    },
    authoriseOperator,
    origins: ORIGINS,
    flagChange: createFlagChangeHandler({ registry, store }),
  });
  return { handler, store };
}

async function call(handler, { token = `tok-${OPERATOR}`, body, raw, contentType = 'application/json; charset=utf-8', path = FLAG_CHANGE_PATH, method = 'POST' } = {}) {
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.writeHead(404); res.end('{}'); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const headers = { 'content-type': contentType };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers, body: method === 'GET' ? undefined : (raw ?? (body === undefined ? undefined : JSON.stringify(body))),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally { await new Promise(r => server.close(r)); }
}

const setBody = (over = {}) => ({
  op: 'set', product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null,
  expectedRevision: 0, value: true, reason: 'enable for pilot', ...over,
});

test('a non-operator token is refused with 403 and nothing is written', async () => {
  const { handler, store } = harness();
  const res = await call(handler, { token: 'tok-someone-else', body: setBody() });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'forbidden' });
  assert.equal(store.commits, 0);
  assert.equal(store.history.length, 0);
});

test('an unauthenticated change is refused with 401', async () => {
  const { handler, store } = harness();
  const res = await call(handler, { token: null, body: setBody() });
  assert.equal(res.status, 401);
  assert.equal(store.commits, 0);
});

test('when operator authority cannot be checked the change is refused with 503', async () => {
  const { handler, store } = harness({ authoriseOperator: async () => { throw new Error('logto down'); } });
  const res = await call(handler, { body: setBody() });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'authority_unavailable' });
  assert.equal(store.commits, 0);
});

test('operator change writes the flag and history records the verified operator as actor', async () => {
  const { handler, store } = harness();
  const res = await call(handler, { body: setBody() });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'changed', revision: 1 });
  assert.equal(store.history.length, 1);
  assert.equal(store.history[0].actor, OPERATOR);
  assert.equal(store.history[0].reason, 'enable for pilot');
  assert.equal(store.history[0].action, 'create');
});

test('a body that names its own actor is refused, so history cannot be attributed to someone else', async () => {
  const { handler, store } = harness();
  const res = await call(handler, { body: setBody({ actor: 'someone-else' }) });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid_command' });
  assert.equal(store.commits, 0);
});

test('stale expected revision is rejected with 409 and no write or history row', async () => {
  const { handler, store } = harness();
  assert.equal((await call(handler, { body: setBody() })).status, 200);
  const stale = await call(handler, { body: setBody({ expectedRevision: 0, value: false, reason: 'second write' }) });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body, { error: 'stale_revision' });
  assert.equal(store.history.length, 1, 'no history row for the refused write');
  assert.equal(store.current.values().next().value.value, true);
  const current = await call(handler, { body: setBody({ expectedRevision: 1, value: false, reason: 'second write' }) });
  assert.deepEqual(current.body, { status: 'changed', revision: 2 });
});

test('rollback restores an earlier revision as a new revision with action rollback and the operator as actor', async () => {
  const { handler, store } = harness();
  await call(handler, { body: setBody({ value: true }) });
  await call(handler, { body: setBody({ expectedRevision: 1, value: false, reason: 'turn off' }) });
  const stale = await call(handler, { body: { op: 'rollback', product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null, expectedRevision: 1, toRevision: 1, reason: 'undo' } });
  assert.equal(stale.status, 409);
  const res = await call(handler, { body: { op: 'rollback', product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: null, expectedRevision: 2, toRevision: 1, reason: 'undo' } });
  assert.deepEqual(res.body, { status: 'changed', revision: 3 });
  const last = store.history[store.history.length - 1];
  assert.equal(last.action, 'rollback');
  assert.equal(last.rollbackToRevision, 1);
  assert.equal(last.actor, OPERATOR);
  assert.equal(store.history.length, 3, 'history keeps every revision');
});

test('an organisation override needs an expiry and is refused without one', async () => {
  const { handler, store } = harness();
  const res = await call(handler, { body: setBody({ organisationId: ORG_A }) });
  assert.equal(res.status, 400);
  assert.equal(store.commits, 0);
  const ok = await call(handler, { body: setBody({ organisationId: ORG_A, expiresAt: FUTURE }) });
  assert.deepEqual(ok.body, { status: 'changed', revision: 1 });
});

test('undeclared flag is refused with 404 and wrong-typed values with 400', async () => {
  const { handler, store } = harness();
  assert.equal((await call(handler, { body: setBody({ key: 'not_declared' }) })).status, 404);
  assert.equal((await call(handler, { body: setBody({ value: 'yes' }) })).status, 400);
  assert.equal(store.commits, 0);
});

test('store failure during a change is reported as 503 with no detail', async () => {
  const store = memoryFlagStore();
  store.failCommits = true;
  const { handler } = harness({ store });
  const res = await call(handler, { body: setBody() });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'flag_store_unavailable' });
});

test('malformed bodies, unexpected fields and query strings are refused before any write', async () => {
  const { handler, store } = harness();
  assert.equal((await call(handler, { raw: '{bad' })).status, 400);
  assert.equal((await call(handler, { raw: JSON.stringify(setBody()), contentType: 'text/plain' })).status, 415);
  assert.equal((await call(handler, { body: setBody({ tenant: ORG_A }) })).status, 400);
  assert.equal((await call(handler, { body: setBody(), path: `${FLAG_CHANGE_PATH}?x=1` })).status, 400);
  assert.equal((await call(handler, { body: setBody(), method: 'GET' })).status, 405);
  assert.equal(store.commits, 0);
});

test('parseFlagChange accepts only the declared shape for each op', () => {
  assert.equal(parseFlagChange({ ...setBody(), extra: 1 }), null);
  assert.equal(parseFlagChange({ ...setBody({ toRevision: 0 }), op: 'rollback' }), null);
  assert.equal(parseFlagChange({ ...setBody(), op: 'delete' }), null);
  assert.equal(parseFlagChange({ ...setBody(), toRevision: 2 }), null, 'toRevision is not a set field');
  assert.equal(parseFlagChange({ ...setBody(), organisationId: 'org-a' }), null);
  assert.equal(parseFlagChange({ ...setBody(), expiresAt: 'not-a-date' }), null);
  const parsed = parseFlagChange({ ...setBody({ organisationId: ORG_A, expiresAt: FUTURE }) });
  assert.ok(parsed.expiresAt instanceof Date);
});

test('flag-change route is off by default and only TITAN_OPERATOR_FLAG_CHANGES=1 serves it', async () => {
  assert.equal(readFlagChangeSetting({}), false);
  assert.equal(readFlagChangeSetting({ TITAN_OPERATOR_FLAG_CHANGES: '0' }), false);
  assert.throws(() => readFlagChangeSetting({ TITAN_OPERATOR_FLAG_CHANGES: 'yes' }), /invalid TITAN_OPERATOR_FLAG_CHANGES/);
  const base = {
    TITAN_OPERATOR_ORGANISATION_ID: 'org_operator_1',
    TITAN_OPERATOR_ROLE_IDS: 'role_admin_1',
    TITAN_LOGTO_MANAGEMENT_ORIGIN: 'https://logto.example.test',
    TITAN_LOGTO_M2M_CLIENT_ID: 'm2m-client-1',
    TITAN_LOGTO_M2M_CLIENT_SECRET: 'not-a-real-secret-for-tests',
    TITAN_LOGTO_MANAGEMENT_RESOURCE: 'https://logto.example.test/api',
    TITAN_LOGTO_MANAGEMENT_SCOPE: 'all',
    TITAN_DESK_ORIGIN: 'https://desk.example.test',
    TITAN_FIELD_ORIGIN: 'https://field.example.test',
    TITAN_ACADEMY_ORIGIN: 'https://academy.example.test',
  };
  const flags = { registry, store: memoryFlagStore() };
  const fakeReq = { url: FLAG_CHANGE_PATH, method: 'POST', headers: {} };
  const sent = [];
  const fakeRes = { writeHead: (s) => sent.push(s), end: () => {} };
  const off = createOperatorAdmin({ env: base, verifyToken: async () => ({}), metrics: createMetrics(), flags, fetcher: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal(await off(fakeReq, fakeRes), false, 'route not handled when off');
  assert.deepEqual(sent, []);
  const on = createOperatorAdmin({ env: { ...base, TITAN_OPERATOR_FLAG_CHANGES: '1' }, verifyToken: async () => ({}), metrics: createMetrics(), flags, fetcher: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal(await on(fakeReq, fakeRes), true, 'route handled when on');
  assert.deepEqual(sent, [401], 'no bearer token is refused before any change');
  await assert.rejects(async () => createOperatorAdmin({ env: { ...base, TITAN_OPERATOR_FLAG_CHANGES: '1' }, verifyToken: async () => ({}), metrics: createMetrics() }), /flag registry and store required/);
});

test('operator authoriser is the Logto check used by the change path', async () => {
  // The real authoriser denies a subject that is not an operator, so the change path inherits that denial.
  const verifier = { assertAnyOrganisationRole: async () => { const { LogtoAuthorityError } = await import('../../../packages/control-plane/dist/logto-management.js'); throw new LogtoAuthorityError('not_member'); } };
  const authorise = createLogtoOperatorAuthoriser({ verifier, operatorOrganisationId: 'org_operator_1', administrativeRoleIds: ['role_admin_1'] });
  assert.equal(await authorise({ logtoSubject: 'user_1' }), false);
});

test('seeded rows are visible to a later read at the revision the change produced', async () => {
  const store = memoryFlagStore();
  seedRow(registry, { product: 'sorted', environment: 'production', key: 'bulk_export', value: false }, store);
  const { handler } = harness({ store });
  const res = await call(handler, { body: setBody({ expectedRevision: 1, value: true, reason: 'enable' }) });
  assert.deepEqual(res.body, { status: 'changed', revision: 2 });
  assert.equal(store.current.values().next().value.revision, 2);
});
