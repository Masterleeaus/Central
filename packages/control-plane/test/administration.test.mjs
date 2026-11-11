import test from 'node:test';
import assert from 'node:assert/strict';
import { readOrganisationAccess, createTenantAdministrationAuthorizer, canDelegateRole } from '../dist/administration.js';
import { LogtoAuthorityError } from '../dist/logto-management.js';
import { ProvisioningForbiddenError } from '../dist/trusted-provisioning.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const M1 = '33333333-3333-4333-8333-333333333333';
const I_ADMIN = '44444444-4444-4444-8444-444444444444';
const I_OWNER = '55555555-5555-4555-8555-555555555555';
const I_MEMBER = '66666666-6666-4666-8666-666666666666';
const ROLE = 'role_tenant_admin';

/** Records every statement so the scope can be asserted: BEGIN READ ONLY, SET LOCAL ROLE, set_config, then reads. */
function recordingPool(rowsFor = () => ({ rows: [] })) {
  const calls = [];
  return { calls, async connect() { return { async query(sql, params) { calls.push([sql, params]); return rowsFor(sql, params); }, release() {} }; } };
}

test('read path opens one read-only snapshot scoped to the organisation before any table read', async () => {
  const pool = recordingPool((sql) => sql.startsWith('SELECT id, logto_organisation_id') ? { rows: [{ id: ORG, logto_organisation_id: 'org_1', state: 'active' }] } : { rows: [] });
  const out = await readOrganisationAccess(pool, ORG);
  assert.equal(pool.calls[0][0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(pool.calls[1][0], 'SET LOCAL ROLE titan_trusted_reader');
  assert.deepEqual(pool.calls[2], ["SELECT set_config('titan.organisation_id', $1, true)", [ORG]]);
  assert.equal(pool.calls.at(-1)[0], 'COMMIT');
  assert.equal(out.organisation.logtoOrganisationId, 'org_1');
});

test('every tenant table read is bound to the requested organisation only', async () => {
  const pool = recordingPool((sql) => sql.startsWith('SELECT id, logto_organisation_id') ? { rows: [{ id: ORG, logto_organisation_id: 'org_1', state: 'active' }] } : { rows: [] });
  await readOrganisationAccess(pool, ORG);
  const tableReads = pool.calls.filter(([sql]) => /titan\.(memberships|entitlements|local_account_links)/.test(sql));
  assert.equal(tableReads.length, 3);
  for (const [sql, params] of tableReads) { assert.match(sql, /organisation_id=\$1/); assert.deepEqual(params, [ORG]); }
  assert.ok(pool.calls.every(([sql]) => !/OTHER|\$2/.test(sql)));
});

test('a missing organisation returns undefined and reads no tenant tables', async () => {
  const pool = recordingPool();
  assert.equal(await readOrganisationAccess(pool, ORG), undefined);
  assert.equal(pool.calls.filter(([sql]) => /memberships|entitlements|local_account_links/.test(sql)).length, 0);
  assert.equal(pool.calls.at(-1)[0], 'COMMIT');
});

test('read path rejects a malformed organisation scope before connecting', async () => {
  let connected = false;
  const pool = { async connect() { connected = true; return {}; } };
  await assert.rejects(readOrganisationAccess(pool, "x' OR 1=1 --"), /scope required/);
  assert.equal(connected, false);
});

test('read path returns memberships, entitlements and links with revisions for the organisation', async () => {
  const pool = recordingPool((sql) => {
    if (sql.startsWith('SELECT id, logto_organisation_id')) return { rows: [{ id: ORG, logto_organisation_id: 'org_1', state: 'active' }] };
    if (sql.includes('FROM titan.memberships')) return { rows: [{ id: M1, identity_id: I_ADMIN, logto_subject: 'usr_a', role: 'admin', state: 'active', expires_at: null, revision: '3' }] };
    if (sql.includes('FROM titan.entitlements')) return { rows: [{ id: 'e1', application_id: 'desk', state: 'active', features: ['read'], expires_at: '2027-01-01T00:00:00Z', revision: 1 }] };
    if (sql.includes('FROM titan.local_account_links')) return { rows: [{ id: 'l1', identity_id: I_ADMIN, application_id: 'desk', local_user_id: 'u', local_account_id: 'a', state: 'verified', verified_at: new Date('2026-01-01T00:00:00Z'), revision: 2 }] };
    return { rows: [] };
  });
  const out = await readOrganisationAccess(pool, ORG);
  assert.deepEqual(out.memberships, [{ id: M1, identityId: I_ADMIN, logtoSubject: 'usr_a', role: 'admin', state: 'active', expiresAt: undefined, revision: 3 }]);
  assert.equal(out.entitlements[0].expiresAt, '2027-01-01T00:00:00.000Z');
  assert.equal(out.links[0].verifiedAt, '2026-01-01T00:00:00.000Z');
});

test('delegation: owners assign up to admin, administrators assign up to manager, nobody assigns owner', () => {
  assert.equal(canDelegateRole('owner', 'admin'), true);
  assert.equal(canDelegateRole('owner', 'owner'), false);
  assert.equal(canDelegateRole('admin', 'admin'), false);
  assert.equal(canDelegateRole('admin', 'manager'), true);
  assert.equal(canDelegateRole('admin', 'owner'), false);
});

/** Fake Logto verifier and tenant store. `logto.member` and `logto.roles` model live Logto state. */
function fixture({ actorRole = 'admin', actorIdentity = I_ADMIN, logto = { member: true, roles: [ROLE], fail: false }, targets = {} } = {}) {
  const store = {
    async actorMembership(subject, org) {
      if (subject !== 'usr_admin' || org !== ORG) return undefined;
      return { id: 'me', identityId: actorIdentity, role: actorRole };
    },
    async membership(id, org) { if (org !== ORG) return undefined; return targets[id]; },
  };
  const verifier = {
    async assertMembership() { if (logto.fail) throw new Error('management api down'); if (!logto.member) throw new LogtoAuthorityError(); },
    async assertAnyOrganisationRole() { if (logto.fail) throw new Error('management api down'); if (!logto.roles.includes(ROLE)) throw new LogtoAuthorityError(); },
  };
  const authorize = createTenantAdministrationAuthorizer({ verifier, resolve: async (type, id) => (type === 'organisation' && id === ORG ? 'org_logto' : undefined), store, administrativeRoleIds: [ROLE] });
  return { authorize };
}
const actor = { logtoSubject: 'usr_admin', operatorAuthorityVerified: true };
const grant = (role, identityId = I_MEMBER) => ({ kind: 'membership', id: M1, identityId, organisationId: ORG, role });
const change = (extra, id = M1) => ({ kind: 'membership_update', id, organisationId: ORG, expectedRevision: 1, ...extra });
const targetOf = (role, identityId = I_MEMBER, state = 'active') => ({ id: M1, identityId, logtoSubject: 'usr_t', role, state, revision: 1 });

test('tenant admin may invite a member at a delegable role', async () => {
  assert.equal(await fixture().authorize(actor, grant('member')), true);
  assert.equal(await fixture().authorize(actor, grant('manager')), true);
});
test('tenant admin may not grant their own role or owner', async () => {
  assert.equal(await fixture().authorize(actor, grant('admin')), false);
  assert.equal(await fixture().authorize(actor, grant('owner')), false);
  assert.equal(await fixture({ actorRole: 'owner', actorIdentity: I_OWNER }).authorize(actor, grant('owner')), false);
  assert.equal(await fixture({ actorRole: 'owner', actorIdentity: I_OWNER }).authorize(actor, grant('admin')), true);
});
test('a plain member or manager cannot administer even with the Logto admin role', async () => {
  assert.equal(await fixture({ actorRole: 'member' }).authorize(actor, grant('learner')), false);
  assert.equal(await fixture({ actorRole: 'manager' }).authorize(actor, grant('learner')), false);
});
test('Logto role or membership missing denies even when Titan says admin', async () => {
  assert.equal(await fixture({ logto: { member: true, roles: [], fail: false } }).authorize(actor, grant('member')), false);
  assert.equal(await fixture({ logto: { member: false, roles: [ROLE], fail: false } }).authorize(actor, grant('member')), false);
});
test('no Titan membership in the organisation denies', async () => {
  assert.equal(await fixture().authorize({ logtoSubject: 'usr_other', operatorAuthorityVerified: true }, grant('member')), false);
});
test('Logto infrastructure failure rejects rather than allowing', async () => {
  await assert.rejects(fixture({ logto: { member: true, roles: [ROLE], fail: true } }).authorize(actor, grant('member')), /down/);
});
test('an untrusted actor flag or identity or organisation creation is refused before any read', async () => {
  let reads = 0;
  const f = createTenantAdministrationAuthorizer({ verifier: {}, resolve: async () => 'org_logto', administrativeRoleIds: [ROLE], store: { async actorMembership() { reads++; }, async membership() { reads++; } } });
  assert.equal(await f({ logtoSubject: 'usr_admin', operatorAuthorityVerified: false }, grant('member')), false);
  assert.equal(await f(actor, { kind: 'identity', id: M1, logtoSubject: 'usr_new' }), false);
  assert.equal(await f(actor, { kind: 'organisation', id: M1, logtoOrganisationId: 'org_new' }), false);
  assert.equal(await f(actor, { kind: 'entitlement', id: M1, organisationId: ORG, applicationId: 'desk', features: [] }), false);
  assert.equal(reads, 0);
});
test('a membership in another organisation is not visible: target lookup fails closed', async () => {
  assert.equal(await fixture({ targets: {} }).authorize(actor, change({ role: 'learner' })), false);
});
test('admin may suspend or demote a lower-ranked member', async () => {
  assert.equal(await fixture({ targets: { [M1]: targetOf('member') } }).authorize(actor, change({ state: 'suspended' })), true);
  assert.equal(await fixture({ targets: { [M1]: targetOf('manager') } }).authorize(actor, change({ role: 'learner' })), true);
});
test('admin may not modify a peer or an owner', async () => {
  assert.equal(await fixture({ targets: { [M1]: targetOf('admin') } }).authorize(actor, change({ state: 'suspended' })), false);
  assert.equal(await fixture({ targets: { [M1]: targetOf('owner', I_OWNER) } }).authorize(actor, change({ state: 'revoked' })), false);
});
test('admin may not promote a lower member to their own role or to owner', async () => {
  assert.equal(await fixture({ targets: { [M1]: targetOf('member') } }).authorize(actor, change({ role: 'admin' })), false);
  assert.equal(await fixture({ targets: { [M1]: targetOf('member') } }).authorize(actor, change({ role: 'owner' })), false);
});
test('no one may change their own membership through the tenant path', async () => {
  assert.equal(await fixture({ targets: { [M1]: targetOf('learner', I_ADMIN) } }).authorize(actor, change({ state: 'suspended' })), false);
  assert.equal(await fixture({ actorRole: 'owner', actorIdentity: I_OWNER, targets: { [M1]: targetOf('admin', I_OWNER) } }).authorize(actor, change({ role: 'manager' })), false);
});
test('admin may not create a membership for their own identity', async () => {
  assert.equal(await fixture().authorize(actor, grant('learner', I_ADMIN)), false);
});
test('ProvisioningForbiddenError carries the stable refusal message', () => {
  const e = new ProvisioningForbiddenError();
  assert.ok(e instanceof Error);
  assert.match(e.message, /provisioning forbidden/);
});
test('authorizer construction rejects missing or duplicate administrator roles', () => {
  const base = { verifier: {}, resolve: async () => 'x', store: {} };
  assert.throws(() => createTenantAdministrationAuthorizer({ ...base, administrativeRoleIds: [] }), /role IDs/);
  assert.throws(() => createTenantAdministrationAuthorizer({ ...base, administrativeRoleIds: ['r', 'r'] }), /role IDs/);
});
