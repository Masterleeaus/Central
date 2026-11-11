import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedTransition, mapSubscriptionToEntitlements, SubscriptionMappingError, SUBSCRIPTION_TRANSITIONS } from '../dist/subscription-model.js';
import { validateCatalogue, resolveGrants, CatalogueError, PLAN_CATALOGUE } from '../dist/plan-catalogue.js';

const PLAN = 'example_field_plus';
const cat = PLAN_CATALOGUE;
const byApp = (changes) => Object.fromEntries(changes.map(c => [c.applicationId, c]));

test('transition table: allowed moves and self-renewals', () => {
  assert.equal(isAllowedTransition(undefined, 'trial'), true);
  assert.equal(isAllowedTransition(undefined, 'active'), true);
  assert.equal(isAllowedTransition(undefined, 'grace'), false, 'a subscription cannot start in grace');
  assert.equal(isAllowedTransition('trial', 'active'), true);
  assert.equal(isAllowedTransition('active', 'grace'), true);
  assert.equal(isAllowedTransition('grace', 'active'), true, 'payment recovered');
  assert.equal(isAllowedTransition('active', 'active'), true, 'renewal');
  assert.equal(isAllowedTransition('cancelled', 'active'), true, 'cancellation reversed before access ends');
});

test('refunded and expired are terminal: no move back to an access state', () => {
  for (const from of ['refunded', 'expired']) {
    for (const to of ['trial', 'active', 'grace', 'cancelled']) assert.equal(isAllowedTransition(from, to), false, `${from} -> ${to}`);
  }
  assert.deepEqual(SUBSCRIPTION_TRANSITIONS.refunded, ['refunded']);
  assert.deepEqual(SUBSCRIPTION_TRANSITIONS.expired, ['expired']);
});

test('trial maps to trialing until trial end, with only the granted products', () => {
  const changes = byApp(mapSubscriptionToEntitlements({ state: 'trial', planId: PLAN, addOnIds: [], trialEndsAt: '2026-12-01T00:00:00.000Z' }, cat));
  assert.deepEqual(changes.field, { applicationId: 'field', state: 'trialing', features: ['clients:read', 'jobs:read', 'session:open', 'team:read', 'visits:read'], expiresAt: '2026-12-01T00:00:00.000Z' });
  assert.equal(changes.desk.state, 'revoked');
  assert.deepEqual(changes.desk.features, []);
});

test('active renewal moves the expiry to the new period end', () => {
  const before = byApp(mapSubscriptionToEntitlements({ state: 'active', planId: PLAN, addOnIds: [], periodEndsAt: '2026-12-01T00:00:00.000Z' }, cat));
  const after = byApp(mapSubscriptionToEntitlements({ state: 'active', planId: PLAN, addOnIds: [], periodEndsAt: '2027-01-01T00:00:00.000Z' }, cat));
  assert.equal(before.field.state, 'active');
  assert.equal(after.field.expiresAt, '2027-01-01T00:00:00.000Z');
});

test('grace period maps to active until graceEndsAt and keeps features', () => {
  const grace = byApp(mapSubscriptionToEntitlements({ state: 'grace', planId: PLAN, addOnIds: [], graceEndsAt: '2026-12-08T00:00:00.000Z' }, cat));
  assert.equal(grace.field.state, 'active');
  assert.equal(grace.field.expiresAt, '2026-12-08T00:00:00.000Z');
  assert.ok(grace.field.features.includes('jobs:read'));
});

test('grace without an end date is rejected rather than granted open-ended (grace length is TO DECIDE)', () => {
  assert.throws(() => mapSubscriptionToEntitlements({ state: 'grace', planId: PLAN, addOnIds: [] }, cat), SubscriptionMappingError);
  assert.throws(() => mapSubscriptionToEntitlements({ state: 'active', planId: PLAN, addOnIds: [] }, cat), /periodEndsAt/);
});

test('cancellation keeps access to the paid period end when given, and revokes now when not', () => {
  const paid = byApp(mapSubscriptionToEntitlements({ state: 'cancelled', planId: PLAN, addOnIds: [], accessEndsAt: '2026-12-31T00:00:00.000Z' }, cat));
  assert.equal(paid.field.state, 'active');
  assert.equal(paid.field.expiresAt, '2026-12-31T00:00:00.000Z');
  const now = byApp(mapSubscriptionToEntitlements({ state: 'cancelled', planId: PLAN, addOnIds: [] }, cat));
  assert.equal(now.field.state, 'revoked');
  assert.deepEqual(now.field.features, []);
});

test('refund revokes every application with no features; expiry maps to expired with no features', () => {
  const refunded = mapSubscriptionToEntitlements({ state: 'refunded', planId: PLAN, addOnIds: [] }, cat);
  assert.ok(refunded.every(c => c.state === 'revoked' && c.features.length === 0 && c.expiresAt === null));
  const expired = byApp(mapSubscriptionToEntitlements({ state: 'expired', planId: PLAN, addOnIds: [] }, cat));
  assert.equal(expired.field.state, 'expired');
  assert.deepEqual(expired.field.features, []);
});

test('add-on features merge into the plan per application; the same input maps to the same output', () => {
  const snapshot = { state: 'active', planId: PLAN, addOnIds: ['example_desk_addon'], periodEndsAt: '2026-12-01T00:00:00.000Z' };
  const first = mapSubscriptionToEntitlements(snapshot, cat);
  assert.deepEqual(first, mapSubscriptionToEntitlements(snapshot, cat));
  const byId = byApp(first);
  assert.equal(byId.desk.state, 'active');
  assert.deepEqual(byId.desk.features, ['communications:read', 'session:open']);
  assert.equal(byId.academy.state, 'revoked');
});

test('unknown plan and unknown add-on are rejected by the mapping', () => {
  assert.throws(() => mapSubscriptionToEntitlements({ state: 'active', planId: 'nope', addOnIds: [], periodEndsAt: '2026-12-01T00:00:00.000Z' }, cat), CatalogueError);
  assert.throws(() => resolveGrants(cat, PLAN, ['nope']), /unknown add-on/);
  assert.throws(() => resolveGrants(cat, PLAN, ['example_desk_addon', 'example_desk_addon']), /more than once/);
});

const valid = () => ({
  plans: { p_one: { products: { field: ['jobs:read'] } } },
  addOns: { a_one: { products: { desk: ['communications:read'] } } },
});

test('catalogue validation accepts a well-formed catalogue and freezes it', () => {
  const c = validateCatalogue(valid());
  assert.equal(c.validated, true);
  assert.ok(Object.isFrozen(c.plans.p_one));
});

test('catalogue validation rejects unknown products, undeclared features, and bad or shared ids', () => {
  assert.throws(() => validateCatalogue({ plans: { p: { products: { payroll: ['jobs:read'] } } }, addOns: {} }), /unknown product "payroll"/);
  assert.throws(() => validateCatalogue({ plans: { p: { products: { field: ['made:up'] } } }, addOns: {} }), /not declared for product "field"/);
  assert.throws(() => validateCatalogue({ plans: { p: { products: { desk: ['jobs:read'] } } }, addOns: {} }), /not declared for product "desk"/);
  assert.throws(() => validateCatalogue({ plans: { 'Bad-Id': { products: { field: ['jobs:read'] } } }, addOns: {} }), /id must match/);
  assert.throws(() => validateCatalogue({ plans: { p: { products: { field: ['jobs:read'] } } }, addOns: { p: { products: { desk: ['communications:read'] } } } }), /more than once/);
  assert.throws(() => validateCatalogue({ plans: { p: { products: {} } }, addOns: {} }), /at least one product/);
  assert.throws(() => validateCatalogue({ plans: {}, addOns: {} }), /no plans/);
  assert.throws(() => validateCatalogue({ plans: null, addOns: {} }), /must declare/);
});

test('catalogue validation reports every problem at once', () => {
  try { validateCatalogue({ plans: { p: { products: { payroll: ['x'] } } }, addOns: {} }); assert.fail('expected throw'); }
  catch (e) { assert.ok(e instanceof CatalogueError); assert.ok(e.problems.length >= 1); }
});
