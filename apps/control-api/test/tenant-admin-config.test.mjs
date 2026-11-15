/** Tenant-administrator role IDs (issue #34): configuration path and the tenant mutation route, with fakes.
 * Owner-provided role IDs are never in the repository; these tests use obvious fixture IDs only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startCentralService } from '../src/server.mjs';
import { readTenantAdminConfig, createOperatorAdmin } from '../src/operator-config.mjs';
import { createMetrics } from '../src/metrics.mjs';

const ORG = '33333333-3333-4333-8333-333333333333';
const ORG_LOGTO = 'org_tenant_fixture';
const OPERATOR_ORG = 'org_operator_fixture';
const OPERATOR_ROLE = 'role_operator_fixture';
const TENANT_ROLE = 'role_tenant_admin_fixture';
const REQUEST = '00000000-0000-4000-8000-000000000001';
const MEMBERSHIP_NEW = '44444444-4444-4444-8444-444444444444';
const IDN_ADMIN = '55555555-5555-4555-8555-555555555555';
const IDN_MEMBER = '66666666-6666-4666-8666-666666666666';
const IDN_INVITEE = '77777777-7777-4777-8777-777777777777';
const MEM_ADMIN = '88888888-8888-4888-8888-888888888888';
const MEM_MEMBER = '99999999-9999-4999-8999-999999999999';
const MGMT_TOKEN = 'mgmt-access-token-fixture-value';
const SECRET = 'fixture-m2m-secret-DO-NOT-LEAK-tenant';

const BASE = {
  TITAN_CENTRAL_DATABASE_URL: 'postgres://unused.example.test/titan_central',
  TITAN_OIDC_ISSUER: 'https://issuer.example.test', TITAN_OIDC_JWKS_URI: 'https://issuer.example.test/jwks',
  TITAN_FIELD_AUDIENCE: 'aud-field', TITAN_DESK_AUDIENCE: 'aud-desk', TITAN_ACADEMY_AUDIENCE: 'aud-academy',
};
const ORIGINS = { desk: 'https://desk.example.test', field: 'https://field.example.test', academy: 'https://academy.example.test' };
const OPERATOR = {
  TITAN_OPERATOR_ORGANISATION_ID: OPERATOR_ORG, TITAN_OPERATOR_ROLE_IDS: OPERATOR_ROLE,
  TITAN_LOGTO_MANAGEMENT_ORIGIN: 'https://logto.example.test', TITAN_LOGTO_M2M_CLIENT_ID: 'm2m-client-fixture',
  TITAN_LOGTO_M2M_CLIENT_SECRET: SECRET, TITAN_LOGTO_MANAGEMENT_RESOURCE: 'https://logto.example.test/api', TITAN_LOGTO_MANAGEMENT_SCOPE: 'all',
  TITAN_DESK_ORIGIN: ORIGINS.desk, TITAN_FIELD_ORIGIN: ORIGINS.field, TITAN_ACADEMY_ORIGIN: ORIGINS.academy,
  TITAN_PRODUCT_TRUSTED_ORIGINS: [ORIGINS.field, ORIGINS.desk, ORIGINS.academy].join(','),
};
const TENANT = { TITAN_TENANT_ADMIN_ROLE_IDS: TENANT_ROLE };
const ok = (value) => ({ ok: true, status: 200, json: async () => value });

/** Fake Logto. `roles` maps a user to the organisation role IDs held in the tenant. */
function fakeLogto({ roles = { usr_tenant_admin: [TENANT_ROLE] } } = {}) {
  const calls = [];
  const members = { [ORG_LOGTO]: ['usr_tenant_admin', 'usr_member', 'usr_invitee'], [OPERATOR_ORG]: ['operator_1'] };
  const fetcher = async (url) => {
    calls.push(String(url));
    const p = new URL(url).pathname;
    if (p === '/oidc/token') return ok({ access_token: MGMT_TOKEN, token_type: 'Bearer', expires_in: 300 });
    if (/^\/api\/users\/[^/]+$/.test(p)) return ok({ id: decodeURIComponent(p.split('/')[3]) });
    const uo = p.match(/^\/api\/users\/([^/]+)\/organizations$/);
    if (uo) {
      const uid = decodeURIComponent(uo[1]);
      return ok(Object.entries(members).filter(([, list]) => list.includes(uid)).map(([org]) => ({ id: org })));
    }
    if (p === `/api/organizations/${ORG_LOGTO}`) return ok({ id: ORG_LOGTO });
    if (p === `/api/organizations/${OPERATOR_ORG}`) return ok({ id: OPERATOR_ORG });
    const r = p.match(/^\/api\/organizations\/([^/]+)\/users\/([^/]+)\/roles$/);
    if (r) return ok((roles[decodeURIComponent(r[2])] ?? []).map((id) => ({ id })));
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetcher, calls };
}

/** Fake database for the statements the tenant route issues: actor and target reads, canonical lookups, and the
 * membership insert with its audit and activity rows. Every other statement returns no rows and is recorded. */
const statements = [];
const identities = { [IDN_ADMIN]: 'usr_tenant_admin', [IDN_MEMBER]: 'usr_member', [IDN_INVITEE]: 'usr_invitee' };
const memberships = [
  { id: MEM_ADMIN, identity_id: IDN_ADMIN, organisation_id: ORG, role: 'admin', state: 'active' },
  { id: MEM_MEMBER, identity_id: IDN_MEMBER, organisation_id: ORG, role: 'member', state: 'active' },
];
const inserted = [];
class RecordingPool {
  async connect() {
    return {
      query: async (sql, params = []) => {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        statements.push(s);
        if (s.startsWith('SELECT m.id, m.identity_id, m.role FROM titan.memberships m JOIN titan.identities i')) {
          const rows = memberships.filter((m) => identities[m.identity_id] === params[0] && m.organisation_id === params[1] && m.state === 'active')
            .map((m) => ({ id: m.id, identity_id: m.identity_id, role: m.role }));
          return { rows, rowCount: rows.length };
        }
        if (s.startsWith('SELECT logto_subject AS value FROM titan.identities WHERE id=$1')) {
          return identities[params[0]] ? { rows: [{ value: identities[params[0]] }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (s.startsWith('SELECT logto_organisation_id AS value FROM titan.organisations WHERE id=$1')) {
          return params[0] === ORG ? { rows: [{ value: ORG_LOGTO }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (s.startsWith('INSERT INTO titan.memberships(')) { inserted.push(['membership', params]); return { rows: [{ id: params[0] }], rowCount: 1 }; }
        if (/^(INSERT|UPDATE|DELETE)\b/.test(s)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
  }
  async end() {}
}
const loadPg = async () => ({ Pool: RecordingPool });
const writes = () => statements.filter((s) => /^(INSERT|UPDATE|DELETE)\b/.test(s));
const TOKENS = { 'tenant-admin-token': 'usr_tenant_admin', 'member-token': 'usr_member', 'operator-token': 'operator_1' };
const verifyToken = async (token) => (TOKENS[token] ? { logtoSubject: TOKENS[token] } : (() => { throw new Error('invalid token'); })());

function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
async function start(env, { fetcher } = {}) {
  const port = await freePort();
  return startCentralService({ env: { ...BASE, ...env, TITAN_CENTRAL_PORT: String(port) }, loadPg, fetcher, verifyToken, logger: () => {} });
}
async function post(service, command, { token = 'tenant-admin-token', requestId = REQUEST } = {}) {
  const port = service.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/v1/admin/tenant/provision`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, authorityReference: 'logto-audit:2026-11-09', command }),
  });
  return { status: res.status, text: await res.text() };
}
const invite = (role = 'member') => ({ kind: 'membership', id: MEMBERSHIP_NEW, identityId: IDN_INVITEE, organisationId: ORG, role });
const reset = () => { statements.length = 0; inserted.length = 0; };

test('readTenantAdminConfig: unset or empty is off; placeholders and malformed values throw, naming only the variable', () => {
  assert.equal(readTenantAdminConfig({}), null);
  assert.equal(readTenantAdminConfig({ TITAN_TENANT_ADMIN_ROLE_IDS: '' }), null);
  assert.deepEqual(readTenantAdminConfig({ TITAN_TENANT_ADMIN_ROLE_IDS: ' role_a , role_b ' }), ['role_a', 'role_b']);
  const thirtyThree = Array.from({ length: 33 }, (_, i) => `role_${i}`).join(',');
  for (const bad of ['REPLACE_ME', 'role_a,REPLACE_ME', 'role_a,role_a', 'has space', 'role_a,', thirtyThree]) {
    assert.throws(() => readTenantAdminConfig({ TITAN_TENANT_ADMIN_ROLE_IDS: bad }), (e) => {
      assert.equal(e.message, 'invalid TITAN_TENANT_ADMIN_ROLE_IDS');
      assert.equal(e.message.includes(bad), false);
      return true;
    });
  }
});

test('tenant role IDs require a database pool when the operator plane is on', () => {
  assert.throws(() => createOperatorAdmin({ env: { ...BASE, ...OPERATOR, ...TENANT }, verifyToken, metrics: createMetrics(), fetcher: async () => ({}) }),
    /TITAN_TENANT_ADMIN_ROLE_IDS requires a database pool/);
});

test('a placeholder tenant role ID stops startup when the operator plane is on', async () => {
  await assert.rejects(start({ ...OPERATOR, TITAN_TENANT_ADMIN_ROLE_IDS: 'REPLACE_ME' }, { fetcher: fakeLogto().fetcher }),
    (e) => { assert.match(e.message, /TITAN_TENANT_ADMIN_ROLE_IDS/); assert.equal(e.message.includes(SECRET), false); return true; });
});

test('unset: the tenant mutation route answers 503 provisioning_disabled and writes nothing', async () => {
  reset();
  const service = await start(OPERATOR, { fetcher: fakeLogto().fetcher });
  try {
    const r = await post(service, invite());
    assert.equal(r.status, 503);
    assert.deepEqual(JSON.parse(r.text), { error: 'provisioning_disabled' });
    assert.equal(writes().length, 0);
  } finally { await service.close(); }
});

test('set but operator plane off: the tenant route is not mounted (404) and no database statement runs', async () => {
  reset();
  const service = await start(TENANT, { fetcher: fakeLogto().fetcher });
  try {
    assert.equal((await post(service, invite())).status, 404);
    assert.equal(statements.length, 0);
  } finally { await service.close(); }
});

test('set: a tenant administrator invites a member at a delegable role and the write is audited', async () => {
  reset();
  const logto = fakeLogto();
  const service = await start({ ...OPERATOR, ...TENANT }, { fetcher: logto.fetcher });
  try {
    const r = await post(service, invite('member'));
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(JSON.parse(r.text), { status: 'created', requestId: REQUEST });
    assert.equal(inserted.length, 1);
    assert.deepEqual(inserted[0][1].slice(1), [IDN_INVITEE, ORG, 'member']);
    assert.ok(statements.some((s) => s.startsWith('INSERT INTO titan.provisioning_audit')), 'audit row written');
    assert.ok(!statements.some((s) => s.startsWith('INSERT INTO titan.identities')), 'no global identity is created');
    assert.ok(!r.text.includes(SECRET) && !r.text.includes(MGMT_TOKEN));
  } finally { await service.close(); }
});

test('set: a plain member is refused before any write', async () => {
  reset();
  const service = await start({ ...OPERATOR, ...TENANT }, { fetcher: fakeLogto().fetcher });
  try {
    assert.equal((await post(service, invite('member'), { token: 'member-token' })).status, 403);
    assert.equal(writes().length, 0);
  } finally { await service.close(); }
});

test('set: a tenant administrator cannot grant their own role or owner (escalation)', async () => {
  for (const role of ['admin', 'owner']) {
    reset();
    const service = await start({ ...OPERATOR, ...TENANT }, { fetcher: fakeLogto().fetcher });
    try {
      assert.equal((await post(service, invite(role))).status, 403, role);
      assert.equal(writes().length, 0, role);
    } finally { await service.close(); }
  }
});

test('set: without the Logto administrator role held in the tenant, the database is not written', async () => {
  reset();
  const service = await start({ ...OPERATOR, ...TENANT }, { fetcher: fakeLogto({ roles: {} }).fetcher });
  try {
    assert.equal((await post(service, invite('member'))).status, 403);
    assert.equal(writes().length, 0);
  } finally { await service.close(); }
});

test('set: other command kinds are refused on the tenant route before any write', async () => {
  reset();
  const service = await start({ ...OPERATOR, ...TENANT }, { fetcher: fakeLogto().fetcher });
  try {
    const r = await post(service, { kind: 'entitlement', id: MEMBERSHIP_NEW, organisationId: ORG, applicationId: 'desk', features: [] });
    assert.equal(r.status, 403);
    assert.deepEqual(JSON.parse(r.text), { error: 'command_not_permitted' });
    assert.equal(writes().length, 0);
  } finally { await service.close(); }
});
