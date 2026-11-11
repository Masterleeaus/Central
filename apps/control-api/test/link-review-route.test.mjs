/** Operator review resolution on POST /v1/admin/provision (issue #37), with fakes for Logto and the database.
 * Provisioning is reached only when the operator plane and link keys are both configured. */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Readable } from 'node:stream';
import { generateKeyPairSync } from 'node:crypto';
import { createAdminHandler } from '../src/admin.mjs';
import { startCentralService } from '../src/server.mjs';
import { LINK_KEYS_JSON_VAR } from '../src/link-key-config.mjs';

const ORIGINS = { desk: 'https://desk.example.test', field: 'https://field.example.test', academy: 'https://academy.example.test' };
const ORG = '33333333-3333-4333-8333-333333333333';
const IDENT = '44444444-4444-4444-8444-444444444444';
const REVIEW = '88888888-8888-4888-8888-888888888888';
const REQUEST = '00000000-0000-4000-8000-000000000001';
const TOKEN = 'aGVhZGVy.Y2xhaW1z.c2ln';
const OP_SUBJECT = 'op_subject_sentinel_77';
const ORG_LOGTO = 'org_operator_1';
const ROLE = 'role_admin_1';
const MGMT_TOKEN = 'mgmt-access-token-VALUE-7d1e';
const SECRET = 'sentinel-m2m-secret-DO-NOT-LEAK-9f2c';

const { publicKey } = generateKeyPairSync('ed25519');
const X = publicKey.export({ format: 'jwk' }).x;
const KEYS_JSON = JSON.stringify([{ productId: 'sorted', keys: [{ kid: 'sorted-2026-01', alg: 'EdDSA', jwk: { kty: 'OKP', crv: 'Ed25519', x: X }, notBefore: '2026-01-01T00:00:00.000Z' }] }]);

const approve = (over = {}) => ({ kind: 'link_review_resolve', id: REVIEW, identityId: IDENT, organisationId: ORG, applicationId: 'field', decision: 'approved', reason: 'Support ticket 123', localUserId: 'user-1', localAccountId: 'acct-1', assertion: TOKEN, ...over });
const reject = (over = {}) => ({ kind: 'link_review_resolve', id: REVIEW, identityId: IDENT, organisationId: ORG, applicationId: 'field', decision: 'rejected', reason: 'Not the account holder', ...over });
const body = (command) => ({ requestId: REQUEST, authorityReference: 'policy:review-1', command });

/** Calls the operator handler directly with fakes for verification, authority and provisioning. */
async function invokeAdmin(payload, { allow = true, verify = async () => ({ logtoSubject: 'operator_1' }), provision } = {}) {
  const calls = [];
  const handler = createAdminHandler({
    verifyToken: verify,
    authoriseOperator: async () => allow,
    provision: provision === null ? undefined : async (...args) => { calls.push(args); return provision ? provision(...args) : 'created'; },
    origins: ORIGINS,
  });
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), {
    url: '/v1/admin/provision', method: 'POST',
    headers: { authorization: 'Bearer operator-token', 'content-type': 'application/json' },
  });
  const res = { status: 0, text: '', writeHead(status) { this.status = status; }, end(text) { this.text = text; } };
  await handler(req, res);
  return { status: res.status, body: JSON.parse(res.text || 'null'), calls };
}

test('a verified operator approval answers 201 and carries the token subject as the actor', async () => {
  const r = await invokeAdmin(body(approve()));
  assert.equal(r.status, 201);
  assert.equal(r.calls[0][0].logtoSubject, 'operator_1');
  assert.equal(r.calls[0][0].operatorAuthorityVerified, true);
  assert.equal(r.calls[0][1].actorSubject, 'operator_1');
  assert.equal(r.calls[0][2].decision, 'approved');
});

test('a rejection answers 200 and needs no assertion', async () => {
  const r = await invokeAdmin(body(reject()), { provision: async () => 'updated' });
  assert.equal(r.status, 200);
  assert.equal(r.calls[0][2].decision, 'rejected');
  assert.equal(r.calls[0][2].assertion, undefined);
  const replay = await invokeAdmin(body(reject()), { provision: async () => 'replayed' });
  assert.equal(replay.status, 200);
});

test('an updated outcome answers 200: relink, revoke and review resolution commit, and were previously refused here', async () => {
  const r = await invokeAdmin(body(approve({ expectedRevision: 2 })), { provision: async () => 'updated' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'updated');
});

test('an unexpected provisioning result is still refused', async () => {
  const r = await invokeAdmin(body(approve()), { provision: async () => 'deleted' });
  assert.equal(r.status, 503);
});

test('malformed resolutions are refused with 400 and never reach provisioning', async () => {
  const bad = [
    reject({ assertion: TOKEN }),
    reject({ localAccountId: 'acct-1' }),
    reject({ expectedRevision: 1 }),
    approve({ assertion: undefined }),
    approve({ assertion: 'not-a-jws' }),
    approve({ expectedRevision: 0 }),
    approve({ localUserId: '' }),
    approve({ reason: undefined }),
    approve({ reason: ' leading space' }),
    approve({ reason: 'x'.repeat(501) }),
    approve({ reason: 'line\nbreak' }),
    approve({ reason: '   ' }),
    approve({ decision: 'maybe' }),
    approve({ owner: 'someone-else' }),
    approve({ identityId: 'not-a-uuid' }),
  ];
  for (const command of bad) {
    const r = await invokeAdmin(body(command));
    assert.equal(r.status, 400, JSON.stringify(command));
    assert.equal(r.calls.length, 0);
  }
});

test('a non-operator is refused with 403 for either decision, and nothing is provisioned', async () => {
  for (const command of [approve(), reject()]) {
    const r = await invokeAdmin(body(command), { allow: false });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'forbidden' });
    assert.equal(r.calls.length, 0);
  }
});

test('an unauthenticated resolution is refused with 401 before any authority check', async () => {
  let authorityCalls = 0;
  const handler = createAdminHandler({
    verifyToken: async () => { throw new Error('invalid token'); },
    authoriseOperator: async () => { authorityCalls++; return true; },
    provision: async () => 'created', origins: ORIGINS,
  });
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body(approve())))]), { url: '/v1/admin/provision', method: 'POST', headers: { authorization: 'Bearer forged', 'content-type': 'application/json' } });
  const res = { status: 0, text: '', writeHead(s) { this.status = s; }, end(t) { this.text = t; } };
  await handler(req, res);
  assert.equal(res.status, 401);
  assert.equal(authorityCalls, 0);
});

test('a provisioning failure answers 503 without the underlying detail', async () => {
  const r = await invokeAdmin(body(approve()), { provision: async () => { throw new Error('revision conflict: account link missing or changed at db-host-7'); } });
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { error: 'provisioning_unavailable' });
});

// ---- startup wiring against the real server, with a recording fake pool and a fake Logto ----

const BASE = {
  TITAN_CENTRAL_DATABASE_URL: 'postgres://unused.example.test/titan_central',
  TITAN_OIDC_ISSUER: 'https://issuer.example.test', TITAN_OIDC_JWKS_URI: 'https://issuer.example.test/jwks',
  TITAN_FIELD_AUDIENCE: 'aud-field', TITAN_DESK_AUDIENCE: 'aud-desk', TITAN_ACADEMY_AUDIENCE: 'aud-academy',
};
const OPERATOR = {
  TITAN_OPERATOR_ORGANISATION_ID: ORG_LOGTO, TITAN_OPERATOR_ROLE_IDS: ROLE,
  TITAN_LOGTO_MANAGEMENT_ORIGIN: 'https://logto.example.test', TITAN_LOGTO_M2M_CLIENT_ID: 'm2m-client-1',
  TITAN_LOGTO_M2M_CLIENT_SECRET: SECRET, TITAN_LOGTO_MANAGEMENT_RESOURCE: 'https://logto.example.test/api', TITAN_LOGTO_MANAGEMENT_SCOPE: 'all',
  TITAN_DESK_ORIGIN: ORIGINS.desk, TITAN_FIELD_ORIGIN: ORIGINS.field, TITAN_ACADEMY_ORIGIN: ORIGINS.academy,
  TITAN_PRODUCT_TRUSTED_ORIGINS: [ORIGINS.field, ORIGINS.desk, ORIGINS.academy].join(','),
};
const ok = (value) => ({ ok: true, status: 200, json: async () => value });

function fakeLogto({ members = [], roles = {} } = {}) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    const p = new URL(url).pathname;
    if (p === '/oidc/token') return ok({ access_token: MGMT_TOKEN, token_type: 'Bearer', expires_in: 300 });
    if (/^\/api\/users\/[^/]+$/.test(p)) return ok({ id: decodeURIComponent(p.split('/')[3]) });
    const uo = p.match(/^\/api\/users\/([^/]+)\/organizations$/);
    if (uo) return ok(members.includes(decodeURIComponent(uo[1])) ? [{ id: ORG_LOGTO }] : []);
    if (p === `/api/organizations/${ORG_LOGTO}`) return ok({ id: ORG_LOGTO });
    if (p === `/api/organizations/${ORG_LOGTO}/users`) return ok(members.map((id) => ({ id })));
    const r = p.match(/^\/api\/organizations\/[^/]+\/users\/([^/]+)\/roles$/);
    if (r) return ok((roles[decodeURIComponent(r[1])] ?? []).map((id) => ({ id })));
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetcher, calls };
}

const statements = [];
let pools = [];
class RecordingPool {
  constructor() { this.ended = false; pools.push(this); }
  async connect() { return { query: async (sql) => { statements.push(String(sql).replace(/\s+/g, ' ').trim()); return { rows: [], rowCount: 0 }; }, release() {} }; }
  async end() { this.ended = true; }
}
const loadPg = async () => ({ Pool: RecordingPool });
const verifyToken = async (token) => (token === 'operator-token' ? { logtoSubject: OP_SUBJECT } : (() => { throw new Error('invalid token'); })());

function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
async function start(env, { fetcher } = {}) {
  const port = await freePort();
  return startCentralService({ env: { ...BASE, ...env, TITAN_CENTRAL_PORT: String(port) }, loadPg, fetcher, verifyToken, logger: () => {} });
}
async function post(service, payload, bearer = 'operator-token') {
  const port = service.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/v1/admin/provision`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: res.status, text: await res.text() };
}
const writes = () => statements.filter((s) => /^(INSERT|UPDATE|DELETE)\b/.test(s));

test('with the operator plane off, /v1/admin/provision is not mounted even when link keys are present', async () => {
  statements.length = 0;
  const logto = fakeLogto({ members: [OP_SUBJECT], roles: { [OP_SUBJECT]: [ROLE] } });
  const service = await start({ [LINK_KEYS_JSON_VAR]: KEYS_JSON }, { fetcher: logto.fetcher });
  try {
    const r = await post(service, body(approve()));
    assert.equal(r.status, 404);
    assert.equal(logto.calls.length, 0);
    assert.equal(statements.length, 0);
  } finally { await service.close(); }
});

test('the operator plane on without link keys answers 503 provisioning_disabled, with no write', async () => {
  statements.length = 0;
  const logto = fakeLogto({ members: [OP_SUBJECT], roles: { [OP_SUBJECT]: [ROLE] } });
  const service = await start(OPERATOR, { fetcher: logto.fetcher });
  try {
    const r = await post(service, body(approve()));
    assert.equal(r.status, 503);
    assert.deepEqual(JSON.parse(r.text), { error: 'provisioning_disabled' });
    assert.equal(writes().length, 0);
  } finally { await service.close(); }
});

test('with plane and keys configured, a non-operator is refused before any database statement', async () => {
  statements.length = 0;
  const logto = fakeLogto({ members: [] });
  const service = await start({ ...OPERATOR, [LINK_KEYS_JSON_VAR]: KEYS_JSON }, { fetcher: logto.fetcher });
  try {
    const r = await post(service, body(approve()));
    assert.equal(r.status, 403);
    assert.equal(statements.length, 0);
  } finally { await service.close(); }
});

test('with plane and keys configured, a verified operator reaches trusted provisioning and writes nothing when the review does not resolve', async () => {
  statements.length = 0;
  const logto = fakeLogto({ members: [OP_SUBJECT], roles: { [OP_SUBJECT]: [ROLE] } });
  const service = await start({ ...OPERATOR, [LINK_KEYS_JSON_VAR]: KEYS_JSON }, { fetcher: logto.fetcher });
  try {
    const r = await post(service, body(approve()));
    assert.equal(r.status, 503);
    assert.deepEqual(JSON.parse(r.text), { error: 'provisioning_unavailable' });
    assert.ok(statements.some((s) => s.startsWith('SELECT logto_organisation_id AS value FROM titan.organisations')), 'canonical organisation resolved through the reader');
    assert.ok(statements.some((s) => s.startsWith('SELECT command_kind, command_digest FROM titan.provisioning_audit')), 'replay check ran before assertion verification');
    assert.equal(writes().length, 0, 'no write statement is issued for an unresolved organisation');
    assert.ok(!r.text.includes(SECRET) && !r.text.includes(MGMT_TOKEN));
  } finally { await service.close(); }
});

test('malformed link keys fail startup, with or without the operator plane', async () => {
  const bad = JSON.stringify([{ productId: 'sorted', keys: [{ kid: 'k', alg: 'RS256', jwk: { kty: 'OKP', crv: 'Ed25519', x: X }, notBefore: '2026-01-01T00:00:00Z' }] }]);
  await assert.rejects(start({ [LINK_KEYS_JSON_VAR]: bad }), /TITAN_LINK_KEYS_JSON: products\[0\]\.keys\[0\]\.alg must be EdDSA/);
  await assert.rejects(start({ ...OPERATOR, [LINK_KEYS_JSON_VAR]: bad }, { fetcher: fakeLogto().fetcher }), /alg must be EdDSA/);
});

test('an operator configuration error after the pool is created closes that pool before startup fails', async () => {
  pools = [];
  await assert.rejects(start({ ...OPERATOR, TITAN_LOGTO_MANAGEMENT_ORIGIN: 'http://logto.example.test' }, { fetcher: fakeLogto().fetcher }), /invalid TITAN_LOGTO_MANAGEMENT_ORIGIN/);
  assert.equal(pools.length, 1);
  assert.equal(pools[0].ended, true);
});
