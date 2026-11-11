import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OnboardingService, OnboardingError, OnboardingUniqueViolation, OnboardingStaleRevision, canTransition, ONBOARDING_STATES, derivedUuid } from '../dist/onboarding.js';
import { TrustedProvisioningService } from '../dist/trusted-provisioning.js';
import { LinkReviewRequired } from '../dist/provisioning.js';

// ---- fake database world, shared by the store and the provisioner ----
const sha = (t) => createHash('sha256').update(t).digest('hex');
function makeWorld() {
  return { identities: new Map(), organisations: new Map(), memberships: new Map(), entitlements: new Map(),
    links: new Map(), reviews: [], audit: new Map(), onboardings: new Map(), products: new Map() };
}
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

/** Emulates the constraints and trigger preconditions of migration 0017 that the module relies on. */
class FakeStore {
  constructor(world) { this.w = world; }
  async findByKey(key) { return clone([...this.w.onboardings.values()].find((r) => r.idempotencyKey === key)); }
  async findById(id) { return clone(this.w.onboardings.get(id)); }
  async insert(row) {
    for (const r of this.w.onboardings.values()) {
      if (r.idempotencyKey === row.idempotencyKey || r.organisationId === row.organisationId || r.logtoOrganisationId === row.logtoOrganisationId) throw new OnboardingUniqueViolation();
    }
    this.w.onboardings.set(row.id, clone(row));
  }
  async transition(input) {
    const r = this.w.onboardings.get(input.id);
    if (!r || r.revision !== input.expectedRevision) throw new OnboardingStaleRevision();
    const rolling = input.rolledBack === true;
    if (!rolling && !canTransition(r.state, input.to)) throw new Error('check_violation: invalid transition');
    if (rolling && (r.state !== 'failed' || r.rolledBackAt)) throw new Error('check_violation: invalid rollback');
    const products = [...this.w.products.values()].filter((p) => p.onboardingId === r.id);
    if (rolling && products.some((p) => (p.entitlementId || p.linkId) && !p.rolledBackAt)) throw new Error('check_violation: open grant');
    if (input.to === 'verified' && !input.ownerProofDigest && !r.ownerProofDigest) throw new Error('check_violation: owner proof');
    if (input.to === 'provisioned') {
      const succeeded = products.filter((p) => p.outcome === 'succeeded' && !p.rolledBackAt).length;
      if (succeeded !== r.products.length) throw new Error('check_violation: products not all succeeded');
      const org = this.w.organisations.get(r.organisationId);
      const membership = [...this.w.memberships.values()].find((m) => m.organisationId === r.organisationId && m.subject === r.ownerLogtoSubject && m.role === 'owner' && m.state === 'active');
      if (!org || !membership) throw new Error('check_violation: canonical org or owner membership missing');
    }
    const next = { ...r, state: input.to, revision: r.revision + 1 };
    if (input.ownerProofDigest) next.ownerProofDigest = input.ownerProofDigest;
    if (input.to !== 'failed') delete next.failureCode;
    if (input.failureCode) next.failureCode = input.failureCode;
    if (rolling) next.rolledBackAt = new Date().toISOString();
    this.w.onboardings.set(r.id, next);
    return clone(next);
  }
  async products(onboardingId) {
    return clone([...this.w.products.values()].filter((p) => p.onboardingId === onboardingId).sort((a, b) => a.application.localeCompare(b.application)));
  }
  async saveProduct(p) {
    const key = `${p.onboardingId}|${p.application}`;
    const prior = this.w.products.get(key);
    if (prior && prior.outcome === 'succeeded' && p.outcome !== 'succeeded') throw new Error('check_violation: granted result cannot fail');
    if (prior && prior.entitlementId && p.entitlementId !== prior.entitlementId) throw new Error('check_violation: granted reference immutable');
    const owner = this.w.onboardings.get(p.onboardingId);
    if (!['verified', 'failed'].includes(owner.state)) throw new Error('check_violation: product result state');
    this.w.products.set(key, clone(p));
  }
  async identityForSubject(subject) { const i = this.w.identities.get(subject); return i && { id: i.id, state: i.state }; }
  async organisationExists(id) { return this.w.organisations.has(id); }
  async membershipFor(identityId, organisationId) { const m = this.w.memberships.get(`${identityId}|${organisationId}`); return m && { role: m.role, state: m.state }; }
  // Scoped by organisation, like the trusted reader's row-level security (migration 0008).
  async entitlement(organisationId, id) { const e = this.w.entitlements.get(id); return e && e.organisationId === organisationId ? clone(e) : undefined; }
  async link(organisationId, id) { const l = this.w.links.get(id); return l && l.organisationId === organisationId ? clone(l) : undefined; }
}

/** Behaves like CentralProvisioner: request-ID replay, conflicts, audit, and review of an ambiguous link. */
class FakeCentral {
  constructor(world, options) { this.w = world; this.options = options; this.calls = []; }
  async apply(context, command) {
    this.calls.push({ kind: command.kind, id: command.id, applicationId: command.applicationId, requestId: context.requestId,
      actorSubject: context.actorSubject, authorityReference: context.authorityReference });
    const hook = (this.options.failures ?? []).find((f) => f.kind === command.kind && (f.app === undefined || f.app === command.applicationId) && f.times > 0);
    if (hook) { hook.times -= 1; throw hook.error(); }
    const digest = JSON.stringify(command);
    const prior = this.w.audit.get(context.requestId);
    if (prior) {
      if (prior.digest !== digest) throw new Error('provisioning request ID reused with different payload');
      return 'replayed';
    }
    const w = this.w;
    switch (command.kind) {
      case 'identity':
        if (w.identities.has(command.logtoSubject)) throw new Error('provisioning conflict: existing record requires explicit review');
        w.identities.set(command.logtoSubject, { id: command.id, subject: command.logtoSubject, state: 'active' });
        break;
      case 'organisation':
        if (w.organisations.has(command.id) || [...w.organisations.values()].some((o) => o.logtoOrganisationId === command.logtoOrganisationId)) throw new Error('provisioning conflict: existing record requires explicit review');
        w.organisations.set(command.id, { id: command.id, logtoOrganisationId: command.logtoOrganisationId });
        break;
      case 'membership': {
        const key = `${command.identityId}|${command.organisationId}`;
        if (w.memberships.has(key)) throw new Error('provisioning conflict: existing record requires explicit review');
        const subject = [...w.identities.values()].find((i) => i.id === command.identityId)?.subject;
        w.memberships.set(key, { id: command.id, identityId: command.identityId, organisationId: command.organisationId, role: command.role, state: 'active', subject });
        break;
      }
      case 'entitlement':
        if ([...w.entitlements.values()].some((e) => e.organisationId === command.organisationId && e.applicationId === command.applicationId)) throw new Error('provisioning conflict: existing record requires explicit review');
        w.entitlements.set(command.id, { id: command.id, organisationId: command.organisationId, applicationId: command.applicationId, state: 'active', revision: 1 });
        break;
      case 'link': {
        if ([...w.links.values()].some((l) => l.identityId === command.identityId && l.organisationId === command.organisationId && l.applicationId === command.applicationId)) throw new Error('provisioning conflict: existing link requires explicit relink or unlink');
        const claimed = [...w.links.values()].find((l) => l.applicationId === command.applicationId && l.localAccountId === command.localAccountId && l.state === 'verified');
        if (claimed) {
          const reviewId = derivedUuid('review', context.requestId);
          w.reviews.push({ id: reviewId, requestId: context.requestId, reason: 'account_claimed_elsewhere' });
          w.audit.set(context.requestId, { digest, kind: command.kind });
          throw new LinkReviewRequired('account_claimed_elsewhere', reviewId);
        }
        w.links.set(command.id, { id: command.id, identityId: command.identityId, organisationId: command.organisationId, applicationId: command.applicationId, localAccountId: command.localAccountId, state: 'verified', revision: 1 });
        break;
      }
      case 'entitlement_update': {
        const e = w.entitlements.get(command.id);
        if (!e || e.revision !== command.expectedRevision || e.organisationId !== command.organisationId) throw new Error('revision conflict: entitlement missing or changed');
        Object.assign(e, { state: command.state, revision: e.revision + 1 });
        break;
      }
      case 'link_revoke': {
        const l = w.links.get(command.id);
        if (!l || l.revision !== command.expectedRevision || l.state !== 'verified') throw new Error('revision conflict: account link missing or changed');
        Object.assign(l, { state: 'revoked', revision: l.revision + 1 });
        break;
      }
      default: throw new Error('unsupported provisioning');
    }
    w.audit.set(context.requestId, { digest, kind: command.kind });
    return 'created';
  }
}

const OPERATOR = { logtoSubject: 'ops_1', operatorAuthorityVerified: true };
const OWNER = { logtoSubject: 'owner_1', verified: true };
const GOOD = 'good.assertion.sig';
const BAD = 'bad.assertion.sig';

function harness(options = {}) {
  const world = makeWorld();
  const store = new FakeStore(world);
  const central = new FakeCentral(world, options);
  const logto = {
    assertIdentity: async () => {},
    assertOrganisation: async () => {},
    assertMembership: async () => { if (options.membershipMissing) throw new Error('membership missing in Logto'); },
  };
  const resolve = async (type, id) => {
    if (type === 'identity') return [...world.identities.values()].find((i) => i.id === id)?.subject;
    return world.organisations.get(id)?.logtoOrganisationId;
  };
  const trusted = new TrustedProvisioningService(central, logto,
    async (actor, command) => (options.authorize ? options.authorize(actor, command) : true),
    resolve,
    async ({ command }) => command.assertion !== BAD);
  const proofCalls = [];
  const ownerProof = {
    verify: async ({ evidence, logtoSubject }) => { proofCalls.push(logtoSubject); return evidence === 'fresh-login' ? sha(`proof:${logtoSubject}`) : undefined; },
  };
  const service = new OnboardingService({ store, provisioner: trusted, ownerProof });
  return { world, store, central, trusted, service, proofCalls };
}

const request = (over = {}) => ({
  idempotencyKey: 'onboard-acme-0000001', logtoOrganisationId: 'logto_org_acme', organisationName: 'Acme Field', products: ['desk', 'field'],
  ...over,
});
const withField = (over = {}) => request({ existingAccounts: { field: { localUserId: 'u1', localAccountId: 'acc-1', assertion: GOOD } }, ...over });

async function expectCode(promise, code) {
  await assert.rejects(promise, (e) => e instanceof OnboardingError && e.code === code, `expected OnboardingError ${code}`);
}

// ---- tests ----

test('start is idempotent: the same key and request return the same record and write nothing', async () => {
  const { service, central, world } = harness();
  const a = await service.start(OWNER, request());
  const b = await service.start(OWNER, request());
  assert.equal(a.id, b.id);
  assert.equal(a.organisationId, b.organisationId);
  assert.equal(a.state, 'pending');
  assert.equal(world.onboardings.size, 1);
  assert.equal(central.calls.length, 0);
});

test('a reused key with a different request or a different owner is refused', async () => {
  const { service } = harness();
  await service.start(OWNER, request());
  await expectCode(service.start(OWNER, request({ products: ['desk'] })), 'idempotency_conflict');
  await expectCode(service.start({ logtoSubject: 'owner_2', verified: true }, request()), 'idempotency_conflict');
});

test('duplicate prevention: a second onboarding for the same Logto organisation is refused and creates nothing', async () => {
  const { service, world } = harness();
  await service.start(OWNER, request());
  await service.proveOwner(OWNER, derivedUuid('onboarding', 'onboard-acme-0000001'), 'fresh-login');
  await service.provision(OPERATOR, request());
  await expectCode(service.start(OWNER, request({ idempotencyKey: 'onboard-acme-0000002' })), 'duplicate');
  assert.equal(world.onboardings.size, 1);
  assert.equal(world.organisations.size, 1);
  assert.equal(world.identities.size, 1);
});

test('duplicate prevention: repeated provisioning creates one organisation, one identity, one membership and one grant per product', async () => {
  const { service, central, world } = harness();
  const row = await service.start(OWNER, withField());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  const first = await service.provision(OPERATOR, withField());
  const callsAfterFirst = central.calls.length;
  const again = await service.provision(OPERATOR, withField());
  assert.equal(first.state, 'provisioned');
  assert.equal(again.state, 'provisioned');
  assert.equal(central.calls.length, callsAfterFirst, 'a provisioned onboarding makes no further provisioning calls');
  assert.equal(world.organisations.size, 1);
  assert.equal(world.identities.size, 1);
  assert.equal(world.memberships.size, 1);
  assert.equal(world.entitlements.size, 2);
  assert.equal(world.links.size, 1);
});

test('owner identity proof is a required step: no provisioning before it, and a rejected proof changes nothing', async () => {
  const { service, central, world, proofCalls } = harness();
  const row = await service.start(OWNER, request());
  await expectCode(service.provision(OPERATOR, request()), 'invalid_state');
  await expectCode(service.proveOwner(OWNER, row.id, 'stale-token'), 'owner_proof_rejected');
  assert.equal((await service.progressForOwner(OWNER, row.id)).state, 'pending');
  assert.equal(central.calls.length, 0);
  const verified = await service.proveOwner(OWNER, row.id, 'fresh-login');
  assert.equal(verified.state, 'verified');
  const repeat = await service.proveOwner(OWNER, row.id, 'fresh-login');
  assert.equal(repeat.ownerProofDigest, verified.ownerProofDigest);
  assert.equal(proofCalls.length, 2, 'a recorded proof is not verified again');
  assert.ok(world.onboardings.get(row.id).ownerProofDigest);
});

test('a different principal cannot prove or read another owner onboarding', async () => {
  const { service } = harness();
  const row = await service.start(OWNER, request());
  const intruder = { logtoSubject: 'owner_2', verified: true };
  await expectCode(service.proveOwner(intruder, row.id, 'fresh-login'), 'not_found');
  await expectCode(service.progressForOwner(intruder, row.id), 'not_found');
});

test('no automatic account matching: an unrelated identity is never reused for the owner', async () => {
  const { service, world } = harness();
  world.identities.set('someone_else', { id: 'd0000000-0000-4000-8000-000000000001', subject: 'someone_else', state: 'active' });
  await expectCode(service.start(OWNER, request({ email: 'owner_1@example.com' })), 'invalid_request');
  const row = await service.start(OWNER, request());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  await service.provision(OPERATOR, request());
  const owned = world.identities.get('owner_1');
  assert.ok(owned, 'the owner identity is created from the authenticated subject');
  assert.notEqual(owned.id, 'd0000000-0000-4000-8000-000000000001');
  assert.equal(world.identities.get('someone_else').id, 'd0000000-0000-4000-8000-000000000001');
});

test('partial failure resumes without granting what was not intended and without re-granting completed products', async () => {
  const failures = [{ kind: 'entitlement', app: 'field', times: 1, error: () => new Error('connection reset by peer') }];
  const { service, central, world } = harness({ failures });
  const row = await service.start(OWNER, request());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  const failed = await service.provision(OPERATOR, request());
  assert.equal(failed.state, 'failed');
  assert.equal(failed.failureCode, 'product_provisioning_failed');
  const view = await service.progressForOwner(OWNER, row.id);
  assert.equal(view.productResults.find((p) => p.application === 'desk').outcome, 'succeeded');
  assert.deepEqual(
    { outcome: view.productResults.find((p) => p.application === 'field').outcome, code: view.productResults.find((p) => p.application === 'field').failureCode },
    { outcome: 'failed', code: 'provisioning_unavailable' });
  assert.equal([...world.entitlements.values()].filter((e) => e.applicationId === 'field').length, 0, 'no field grant after the failure');

  const resumed = await service.provision(OPERATOR, request());
  assert.equal(resumed.state, 'provisioned');
  const deskCreates = central.calls.filter((c) => c.kind === 'entitlement' && c.applicationId === 'desk');
  assert.equal(deskCreates.length, 1, 'the completed desk grant is not attempted again');
  assert.equal(world.entitlements.size, 2);
  assert.equal(world.organisations.size, 1);
  assert.equal(world.identities.size, 1);
});

test('a resume with a different request is refused, so no unintended product can be added', async () => {
  const failures = [{ kind: 'entitlement', app: 'field', times: 1, error: () => new Error('timeout') }];
  const { service, central, world } = harness({ failures });
  const row = await service.start(OWNER, request());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  await service.provision(OPERATOR, request());
  const callsBefore = central.calls.length;
  await expectCode(service.provision(OPERATOR, request({ products: ['desk', 'academy'] })), 'idempotency_conflict');
  await expectCode(service.provision(OPERATOR, request({ products: ['desk'] })), 'idempotency_conflict');
  assert.equal(central.calls.length, callsBefore);
  assert.equal([...world.entitlements.values()].filter((e) => e.applicationId === 'academy').length, 0);
});

test('each product reports a structured failure: not_authorised, conflict, account_link_review, and success for the rest', async () => {
  const options = {
    authorize: (actor, command) => !(command.kind === 'entitlement' && command.applicationId === 'desk'),
  };
  const { service, world } = harness(options);
  const row = await service.start(OWNER, request({ products: ['desk', 'field', 'academy'], existingAccounts: {
    academy: { localUserId: 'u9', localAccountId: 'acc-9', assertion: GOOD },
  } }));
  // field: the owner's organisation already holds a field grant that this onboarding did not create
  world.entitlements.set('f0000000-0000-4000-8000-000000000001', { id: 'f0000000-0000-4000-8000-000000000001', organisationId: row.organisationId, applicationId: 'field', state: 'active', revision: 1 });
  // academy: the local account is already verified for another identity
  world.links.set('f0000000-0000-4000-8000-000000000002', { id: 'f0000000-0000-4000-8000-000000000002', identityId: 'x', organisationId: 'y', applicationId: 'academy', localAccountId: 'acc-9', state: 'verified', revision: 1 });
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  const result = await service.provision(OPERATOR, request({ products: ['desk', 'field', 'academy'], existingAccounts: {
    academy: { localUserId: 'u9', localAccountId: 'acc-9', assertion: GOOD },
  } }));
  assert.equal(result.state, 'failed');
  const byApp = Object.fromEntries((await service.progressForOwner(OWNER, row.id)).productResults.map((p) => [p.application, p]));
  assert.equal(byApp.desk.failureCode, 'not_authorised');
  assert.equal(byApp.field.failureCode, 'conflict');
  assert.equal(byApp.academy.failureCode, 'account_link_review');
  assert.equal(byApp.academy.outcome, 'failed');
  assert.equal(world.reviews.length, 1, 'the ambiguous link is queued for review, not resolved');
});

test('a link sent to review is not reported as success when the request is replayed on resume', async () => {
  const { service, world } = harness();
  world.links.set('f0000000-0000-4000-8000-000000000003', { id: 'f0000000-0000-4000-8000-000000000003', identityId: 'x', organisationId: 'y', applicationId: 'field', localAccountId: 'acc-1', state: 'verified', revision: 1 });
  const row = await service.start(OWNER, withField());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  const first = await service.provision(OPERATOR, withField());
  assert.equal(first.state, 'failed');
  const second = await service.provision(OPERATOR, withField());
  assert.equal(second.state, 'failed', 'a replayed review is not a link');
  const field = (await service.progressForOwner(OWNER, row.id)).productResults.find((p) => p.application === 'field');
  assert.equal(field.failureCode, 'account_link_review');
  assert.equal(world.links.has(field.linkId ?? ''), false);
  assert.equal([...world.links.values()].filter((l) => l.identityId !== 'x').length, 0, 'no link was written for the owner');
});

test('rollback revokes what this onboarding granted, is final, and cannot be resumed', async () => {
  const { service, world } = harness();
  world.links.set('f0000000-0000-4000-8000-000000000004', { id: 'f0000000-0000-4000-8000-000000000004', identityId: 'x', organisationId: 'y', applicationId: 'field', localAccountId: 'acc-1', state: 'verified', revision: 1 });
  const row = await service.start(OWNER, withField());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  await expectCode(service.rollback(OPERATOR, row.id), 'invalid_state');
  await service.provision(OPERATOR, withField());
  const rolled = await service.rollback(OPERATOR, row.id);
  assert.ok(rolled.rolledBackAt);
  assert.equal(rolled.state, 'failed');
  for (const e of world.entitlements.values()) assert.equal(e.state, 'revoked');
  assert.equal((await service.rollback(OPERATOR, row.id)).rolledBackAt, rolled.rolledBackAt, 'rollback is idempotent');
  await expectCode(service.provision(OPERATOR, withField()), 'rolled_back');
});

test('rollback of a failed onboarding revokes the grants that were made before the failure', async () => {
  const { service, world } = harness();
  world.links.set('f0000000-0000-4000-8000-000000000005', { id: 'f0000000-0000-4000-8000-000000000005', identityId: 'x', organisationId: 'y', applicationId: 'field', localAccountId: 'acc-1', state: 'verified', revision: 1 });
  const row = await service.start(OWNER, withField());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  const failed = await service.provision(OPERATOR, withField());
  assert.equal(failed.state, 'failed');
  const desk = (await service.progressForOwner(OWNER, row.id)).productResults.find((p) => p.application === 'desk');
  assert.equal(world.entitlements.get(desk.entitlementId).state, 'active');
  await service.rollback(OPERATOR, row.id);
  assert.equal(world.entitlements.get(desk.entitlementId).state, 'revoked');
});

test('state machine: every transition the module can take is allowed by the migration trigger, and nothing else', () => {
  const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations', '0017_customer_onboarding.sql'), 'utf8');
  const block = migration.match(/\(OLD\.state, NEW\.state\) NOT IN \(((?:\('\w+','\w+'\),?\s*)+)\)/);
  assert.ok(block, 'the trigger lists its allowed transitions');
  const fromTrigger = new Set([...block[1].matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => `${m[1]}->${m[2]}`));
  const fromCode = new Set();
  for (const from of ONBOARDING_STATES) for (const to of ONBOARDING_STATES) if (canTransition(from, to)) fromCode.add(`${from}->${to}`);
  assert.deepEqual([...fromCode].sort(), [...fromTrigger].sort());
  assert.equal(canTransition('provisioned', 'verified'), false, 'provisioned is terminal');
  assert.equal(canTransition('pending', 'provisioned'), false, 'pending cannot skip verification');
});

test('tenant isolation: one organisation cannot read or affect another organisation onboarding', async () => {
  const { service, world } = harness();
  const a = await service.start(OWNER, request());
  const bOwner = { logtoSubject: 'owner_2', verified: true };
  const b = await service.start(bOwner, request({ idempotencyKey: 'onboard-beta-0000002', logtoOrganisationId: 'logto_org_beta', organisationName: 'Beta Works', products: ['academy'] }));
  assert.notEqual(a.organisationId, b.organisationId);
  await expectCode(service.progressForOrganisation(b.organisationId, a.id), 'not_found');
  await expectCode(service.progressForOrganisation(a.organisationId, b.id), 'not_found');
  const own = await service.progressForOrganisation(a.organisationId, a.id);
  assert.equal(own.id, a.id);
  assert.ok(own.productResults.every((p) => p.organisationId === a.organisationId));
  await service.proveOwner(bOwner, b.id, 'fresh-login');
  await service.provision(OPERATOR, request({ idempotencyKey: 'onboard-beta-0000002', logtoOrganisationId: 'logto_org_beta', organisationName: 'Beta Works', products: ['academy'] }));
  assert.equal((await service.progressForOrganisation(a.organisationId, a.id)).state, 'pending', 'the other tenant provisioning does not touch this record');
  assert.equal([...world.entitlements.values()].filter((e) => e.organisationId === a.organisationId).length, 0);
});

test('only the trusted provisioning path mutates access, and only for an authenticated operator', async () => {
  const { service, central } = harness();
  const row = await service.start(OWNER, withField());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  await expectCode(service.provision({ logtoSubject: 'ops_1', operatorAuthorityVerified: false }, withField()), 'unauthenticated');
  assert.equal(central.calls.length, 0);
  await service.provision(OPERATOR, withField());
  assert.ok(central.calls.length > 0);
  for (const call of central.calls) {
    assert.equal(call.actorSubject, OPERATOR.logtoSubject);
    assert.equal(call.authorityReference, `onboarding:${row.id}`);
  }
});

test('the trusted provisioning gate still applies: a denied actor produces a structured failure, not access', async () => {
  const { service, world } = harness({ authorize: () => false });
  const row = await service.start(OWNER, request());
  await service.proveOwner(OWNER, row.id, 'fresh-login');
  const result = await service.provision(OPERATOR, request());
  assert.equal(result.state, 'failed');
  assert.equal(result.failureCode, 'core_provisioning_failed');
  assert.equal(world.entitlements.size, 0);
  assert.equal(world.organisations.size, 0);
});
