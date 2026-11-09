import test from 'node:test';
import assert from 'node:assert/strict';
import { CentralProvisioner } from '../dist/provisioning.js';
import { fakeControlDb } from './helpers/fake-control-db.mjs';

const ORG = '33333333-3333-4333-8333-333333333333';
const ENT = '44444444-4444-4444-8444-444444444444';
const ctx = (n) => ({ requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, actorSubject: 'billing:fake-billing', authorityReference: 'test' });
const seed = (over = {}) => ({ id: ENT, organisation_id: ORG, application_id: 'field', state: 'active', features: ['jobs:read', 'team:read'], expires_at: null, revision: 1, ...over });
const MEMBER = { logto_subject: 'usr_1', organisation_id: ORG };
const bumps = (db) => db.revocationsFor('field', 'usr_1', ORG);
const update = (over) => ({ kind: 'entitlement_update', id: ENT, organisationId: ORG, expectedRevision: 1, state: 'active', ...over });

test('removing a feature revokes sessions for the application', async () => {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements: [seed()] });
  assert.equal(await new CentralProvisioner(db.pool).apply(ctx(1), update({ features: ['jobs:read'] })), 'updated');
  assert.deepEqual(db.state.entitlements[0].features, ['jobs:read']);
  assert.equal(bumps(db), 1);
});

test('adding a feature, or keeping the same set, does not revoke', async () => {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements: [seed()] });
  await new CentralProvisioner(db.pool).apply(ctx(2), update({ features: ['jobs:read', 'team:read', 'visits:read'] }));
  assert.equal(bumps(db), 0);
  assert.equal(db.state.entitlements[0].revision, 2);
});

test('an expiry moved earlier, or made finite where it was open, revokes; moved later does not', async () => {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements: [seed({ expires_at: '2026-12-10T00:00:00.000Z' })] });
  const p = new CentralProvisioner(db.pool);
  await p.apply(ctx(3), update({ expiresAt: '2026-12-20T00:00:00.000Z' }));
  assert.equal(bumps(db), 0, 'later expiry is not a reduction');
  await p.apply(ctx(4), update({ expectedRevision: 2, expiresAt: '2026-12-01T00:00:00.000Z' }));
  assert.equal(bumps(db), 1, 'earlier expiry is a reduction');
  await p.apply(ctx(5), update({ expectedRevision: 3, expiresAt: null }));
  assert.equal(bumps(db), 1, 'clearing the expiry widens access');
  await p.apply(ctx(6), update({ expectedRevision: 4, expiresAt: '2026-12-05T00:00:00.000Z' }));
  assert.equal(bumps(db), 2, 'an open expiry becoming finite is a reduction');
});

test('omitted features and expiry keep their current values', async () => {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements: [seed({ expires_at: '2026-12-10T00:00:00.000Z' })] });
  await new CentralProvisioner(db.pool).apply(ctx(7), update({ state: 'trialing' }));
  assert.deepEqual(db.state.entitlements[0].features, ['jobs:read', 'team:read']);
  assert.equal(db.state.entitlements[0].expires_at, '2026-12-10T00:00:00.000Z');
});

test('the row change, the revocation bump and the audit record commit together or not at all', async () => {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements: [seed()] });
  db.failNext(/^INSERT INTO titan\.titan_session_revocations/, Error('db down'));
  await assert.rejects(new CentralProvisioner(db.pool).apply(ctx(8), update({ features: ['jobs:read'] })), /db down/);
  assert.deepEqual(db.state.entitlements[0].features, ['jobs:read', 'team:read'], 'row unchanged');
  assert.equal(db.state.entitlements[0].revision, 1);
  assert.equal(db.state.audit.length, 0);
});

test('replaying the same request does not bump sessions a second time', async () => {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements: [seed()] });
  const p = new CentralProvisioner(db.pool);
  await p.apply(ctx(9), update({ features: ['jobs:read'] }));
  assert.equal(await p.apply(ctx(9), update({ features: ['jobs:read'] })), 'replayed');
  assert.equal(bumps(db), 1);
});

test('malformed feature lists and expiries are rejected before any SQL runs', async () => {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements: [seed()] });
  const p = new CentralProvisioner(db.pool);
  await assert.rejects(p.apply(ctx(10), update({ features: ['a', 'a'] })), /invalid entitlement update/);
  await assert.rejects(p.apply(ctx(11), update({ features: [''] })), /invalid entitlement update/);
  await assert.rejects(p.apply(ctx(12), update({ features: 'jobs:read' })), /invalid entitlement update/);
  await assert.rejects(p.apply(ctx(13), update({ expiresAt: '2026-12-01' })), /invalid entitlement update/);
  await assert.rejects(p.apply(ctx(14), update({ expiresAt: 'tomorrow' })), /invalid entitlement update/);
  assert.equal(db.log.filter(q => q === 'BEGIN').length, 0);
});

test('a stored expiry that comes back as a Date object is read correctly', async () => {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements: [seed({ expires_at: new Date('2026-12-10T00:00:00.000Z') })] });
  await new CentralProvisioner(db.pool).apply(ctx(15), update({ expiresAt: '2026-12-11T00:00:00.000Z' }));
  assert.equal(bumps(db), 0);
});
