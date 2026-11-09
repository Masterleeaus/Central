import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionLifecycle } from '../dist/subscription-lifecycle.js';
import { CentralProvisioner } from '../dist/provisioning.js';
import { PostgresEntitlementReader } from '../dist/billing-ledger-pg.js';
import { PLAN_CATALOGUE } from '../dist/plan-catalogue.js';
import { fakeAdapter, deliver, FAKE_SECRET } from './helpers/fake-billing-provider.mjs';
import { memoryLedger } from './helpers/memory-billing-ledger.mjs';
import { fakeControlDb } from './helpers/fake-control-db.mjs';

const ORG = '33333333-3333-4333-8333-333333333333';
const OTHER_ORG = '55555555-5555-4555-8555-555555555555';
const ENT = '44444444-4444-4444-8444-444444444444';
const PLUS = 'example_field_plus';
const BASIC = 'example_field_basic';
const MEMBER = { logto_subject: 'usr_1', organisation_id: ORG };

function harness({ entitlements = [], readerShift = 0 } = {}) {
  const db = fakeControlDb({ memberships: [MEMBER], entitlements });
  const ledger = memoryLedger();
  const real = new PostgresEntitlementReader(db.pool);
  const reader = { entitlement: async (o, a) => { const r = await real.entitlement(o, a); return r && readerShift ? { ...r, revision: r.revision + readerShift } : r; } };
  const lc = new SubscriptionLifecycle({ adapter: fakeAdapter(), secret: FAKE_SECRET, ledger, entitlements: reader, provisioning: new CentralProvisioner(db.pool), catalogue: PLAN_CATALOGUE });
  const send = (body, opts) => lc.handle(deliver(body, opts));
  const field = () => db.state.entitlements.find(e => e.application_id === 'field');
  return { db, ledger, send, field };
}
const ev = (id, state, extra = {}) => ({ id, subscription: 'sub_1', organisation: ORG, occurred: '2026-11-01T00:00:00.000Z', state, plan: PLUS, addOns: [], ...extra });
const REVOKE_KEY = () => ['field', 'usr_1', ORG];

test('trial start creates a trialing entitlement through the provisioning path', async () => {
  const h = harness();
  const out = await h.send(ev('evt_1', 'trial', { trialEndsAt: '2026-12-01T00:00:00.000Z' }));
  assert.equal(out.status, 'applied');
  assert.equal(h.field().state, 'trialing');
  assert.equal(h.field().expires_at, '2026-12-01T00:00:00.000Z');
  assert.ok(h.field().features.includes('visits:read'));
  assert.deepEqual(h.db.state.audit.map(a => a.command_kind), ['entitlement', 'entitlement_update']);
  assert.equal(h.ledger.subs.get('fake-billing|sub_1').state, 'trial');
  assert.equal(h.ledger.events.get('fake-billing|evt_1').disposition, 'applied');
});

test('a replayed delivery is a duplicate: no second mutation and no second audit row', async () => {
  const h = harness();
  const body = ev('evt_1', 'trial', { trialEndsAt: '2026-12-01T00:00:00.000Z' });
  await h.send(body);
  const audit = h.db.state.audit.length;
  const revision = h.field().revision;
  assert.deepEqual(await h.send(body), { status: 'duplicate' });
  assert.equal(h.db.state.audit.length, audit);
  assert.equal(h.field().revision, revision);
});

test('trial -> active -> grace -> expired: grace keeps access to graceEndsAt, expiry revokes sessions once', async () => {
  const h = harness();
  await h.send(ev('e1', 'trial', { trialEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-01T00:00:00Z' }));
  await h.send(ev('e2', 'active', { periodEndsAt: '2026-12-15T00:00:00.000Z', occurred: '2026-11-02T00:00:00Z' }));
  assert.equal(h.field().state, 'active');
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 0, 'trial to active is not a reduction');
  await h.send(ev('e3', 'grace', { graceEndsAt: '2026-12-22T00:00:00.000Z', occurred: '2026-11-03T00:00:00Z' }));
  assert.equal(h.field().state, 'active');
  assert.equal(h.field().expires_at, '2026-12-22T00:00:00.000Z');
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 0, 'grace keeps features and does not revoke');
  await h.send(ev('e4', 'expired', { occurred: '2026-12-23T00:00:00Z' }));
  assert.equal(h.field().state, 'expired');
  assert.deepEqual(h.field().features, []);
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 1, 'expiry is a removal and revokes sessions');
});

test('cancellation keeps access to the paid period end without revoking; the later expiry revokes', async () => {
  const h = harness();
  await h.send(ev('e1', 'active', { periodEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-01T00:00:00Z' }));
  const cancel = await h.send(ev('e2', 'cancelled', { accessEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-05T00:00:00Z' }));
  assert.equal(cancel.status, 'applied');
  assert.equal(cancel.mutations, 0, 'same grant, nothing to write');
  assert.equal(h.field().state, 'active');
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 0);
  await h.send(ev('e3', 'expired', { occurred: '2026-12-02T00:00:00Z' }));
  assert.equal(h.field().state, 'expired');
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 1);
});

test('cancellation without an access end revokes now and revokes sessions', async () => {
  const h = harness();
  await h.send(ev('e1', 'active', { periodEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-01T00:00:00Z' }));
  await h.send(ev('e2', 'cancelled', { occurred: '2026-11-05T00:00:00Z' }));
  assert.equal(h.field().state, 'revoked');
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 1);
});

test('refund revokes and bumps sessions; a later "active" cannot re-enable it; an older one is ignored', async () => {
  const h = harness();
  await h.send(ev('e1', 'active', { periodEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-01T00:00:00Z' }));
  await h.send(ev('e2', 'refunded', { occurred: '2026-11-10T00:00:00Z' }));
  assert.equal(h.field().state, 'revoked');
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 1);
  const late = await h.send(ev('e3', 'active', { periodEndsAt: '2027-01-01T00:00:00.000Z', occurred: '2026-11-12T00:00:00Z' }));
  assert.deepEqual(late, { status: 'rejected', code: 'transition_not_allowed', reason: 'refunded->active' });
  const delayed = await h.send(ev('e4', 'active', { periodEndsAt: '2027-01-01T00:00:00.000Z', occurred: '2026-11-05T00:00:00Z' }));
  assert.deepEqual(delayed, { status: 'ignored', reason: 'out_of_order' });
  assert.equal(h.field().state, 'revoked');
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 1, 'rejected events write nothing');
  assert.equal(h.ledger.events.get('fake-billing|e3').disposition, 'rejected_transition');
  assert.equal(h.ledger.events.get('fake-billing|e4').disposition, 'ignored_out_of_order');
});

test('an older event delivered late is ignored and recorded; the newer state stands', async () => {
  const h = harness();
  await h.send(ev('e1', 'trial', { trialEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-01T00:00:00Z' }));
  await h.send(ev('e2', 'active', { periodEndsAt: '2026-12-15T00:00:00.000Z', occurred: '2026-11-03T00:00:00Z' }));
  const late = await h.send(ev('e3', 'grace', { graceEndsAt: '2026-12-22T00:00:00.000Z', occurred: '2026-11-02T00:00:00Z' }));
  assert.deepEqual(late, { status: 'ignored', reason: 'out_of_order' });
  assert.equal(h.field().state, 'active');
  assert.equal(h.field().expires_at, '2026-12-15T00:00:00.000Z');
  assert.equal(h.ledger.events.get('fake-billing|e3').disposition, 'ignored_out_of_order');
});

test('events with the same timestamp are ordered by provider event id, deterministically', async () => {
  const h = harness();
  const at = '2026-11-02T00:00:00Z';
  await h.send(ev('e1', 'trial', { trialEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-01T00:00:00Z' }));
  assert.equal((await h.send(ev('evt_z', 'grace', { graceEndsAt: '2026-12-08T00:00:00.000Z', occurred: at }))).status, 'applied');
  assert.deepEqual(await h.send(ev('evt_a', 'active', { periodEndsAt: '2026-12-15T00:00:00.000Z', occurred: at })), { status: 'ignored', reason: 'out_of_order' });
});

test('an event for an organisation other than the subscription owner is rejected', async () => {
  const h = harness();
  await h.send(ev('e1', 'active', { periodEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-01T00:00:00Z' }));
  const out = await h.send(ev('e2', 'refunded', { organisation: OTHER_ORG, occurred: '2026-11-02T00:00:00Z' }));
  assert.equal(out.code, 'organisation_mismatch');
  assert.equal(h.ledger.events.get('fake-billing|e2').disposition, 'rejected_organisation');
  assert.equal(h.field().state, 'active');
});

test('an unknown plan is rejected by the mapping, recorded, and writes nothing', async () => {
  const h = harness();
  const out = await h.send(ev('e1', 'active', { plan: 'not_a_plan', periodEndsAt: '2026-12-01T00:00:00.000Z' }));
  assert.equal(out.status, 'rejected');
  assert.equal(out.code, 'mapping_invalid');
  assert.equal(h.ledger.events.get('fake-billing|e1').disposition, 'rejected_invalid');
  assert.equal(h.db.state.audit.length, 0);
});

test('a subscription cannot start in grace; the rejection is recorded', async () => {
  const h = harness();
  const out = await h.send(ev('e1', 'grace', { graceEndsAt: '2026-12-08T00:00:00.000Z' }));
  assert.deepEqual(out, { status: 'rejected', code: 'transition_not_allowed', reason: 'none->grace' });
  assert.equal(h.db.state.entitlements.length, 0);
});

test('signature failure, staleness and bad payloads never reach the ledger or provisioning', async () => {
  const ledger = memoryLedger();
  const provisioning = { apply: async () => { throw Error('must not run'); } };
  const lc = new SubscriptionLifecycle({ adapter: fakeAdapter(), secret: FAKE_SECRET, ledger, entitlements: { entitlement: async () => undefined }, provisioning, catalogue: PLAN_CATALOGUE });
  const body = ev('e1', 'trial', { trialEndsAt: '2026-12-01T00:00:00.000Z' });
  assert.deepEqual(await lc.handle(deliver(body, { secret: 'attacker-secret-value-0123456789abcd' })), { status: 'rejected', code: 'bad_signature' });
  assert.deepEqual(await lc.handle(deliver(body, { at: Math.floor(Date.now() / 1000) - 3600 })), { status: 'rejected', code: 'stale_timestamp' });
  assert.deepEqual(await lc.handle(deliver('{"id":"x"}')), { status: 'rejected', code: 'invalid_payload' });
  assert.deepEqual(await lc.handle(deliver('{not json')), { status: 'rejected', code: 'invalid_payload' });
  assert.equal(ledger.events.size, 0);
});

test('a failed write leaves the event pending and no partial state; redelivery applies it', async () => {
  const h = harness();
  const body = ev('e1', 'active', { periodEndsAt: '2026-12-01T00:00:00.000Z' });
  h.db.failNext(/^INSERT INTO titan\.provisioning_audit/, Error('database unavailable'));
  await assert.rejects(h.send(body), /database unavailable/);
  assert.equal(h.db.state.entitlements.length, 0, 'the failed transaction rolled back the row');
  assert.equal(h.ledger.events.get('fake-billing|e1').disposition, 'pending');
  assert.equal((await h.send(body)).status, 'applied');
  assert.equal(h.field().state, 'active');
  assert.equal(h.ledger.events.get('fake-billing|e1').disposition, 'applied');
});

test('a stale read is refused by the expected revision check and nothing is written', async () => {
  const h = harness({ readerShift: -1, entitlements: [{ id: ENT, organisation_id: ORG, application_id: 'field', state: 'active', features: ['jobs:read'], expires_at: null, revision: 3 }] });
  await assert.rejects(h.send(ev('e1', 'active', { plan: BASIC, periodEndsAt: '2026-12-01T00:00:00.000Z' })), /revision conflict/);
  assert.equal(h.field().revision, 3);
  assert.equal(h.ledger.events.get('fake-billing|e1').disposition, 'pending');
});

test('a plan change that removes a feature revokes sessions and keeps the new feature set', async () => {
  const h = harness();
  await h.send(ev('e1', 'active', { plan: PLUS, periodEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-01T00:00:00Z' }));
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 0);
  await h.send(ev('e2', 'active', { plan: BASIC, periodEndsAt: '2026-12-01T00:00:00.000Z', occurred: '2026-11-02T00:00:00Z' }));
  assert.ok(!h.field().features.includes('team:read'));
  assert.equal(h.db.revocationsFor(...REVOKE_KEY()), 1);
});

test('the lifecycle refuses an unvalidated catalogue and a missing secret', () => {
  const base = { adapter: fakeAdapter(), secret: FAKE_SECRET, ledger: memoryLedger(), entitlements: { entitlement: async () => undefined }, provisioning: { apply: async () => {} } };
  assert.throws(() => new SubscriptionLifecycle({ ...base, catalogue: { plans: {}, addOns: {} } }), /validated plan catalogue/);
  assert.throws(() => new SubscriptionLifecycle({ ...base, secret: '', catalogue: PLAN_CATALOGUE }), /secret is required/);
});
