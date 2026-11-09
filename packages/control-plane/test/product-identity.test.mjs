import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CentralAccessService,
  buildProductRegistry,
  planLookup,
  originsForLegacyIds,
  repositoryIdentity,
  resolveProduct,
  probeProduct,
  ProductRegistryError,
} from '../dist/index.js';

const now = '2026-11-02T12:00:00Z';
const ORIGINS = { sorted: 'https://sorted.titanzero.io', supercharged: 'https://supercharged.titanzero.io', lms: 'https://lms.titanzero.io' };
const registry = () => buildProductRegistry({ serviceOrigins: ORIGINS, trustedOrigins: Object.values(ORIGINS) });

// Same shape as access.test.mjs, with a switchable entitlement so decisions can be compared.
function accessFixture({ entitled }) {
  const identity = { id: 'ti-1', logtoSubject: 'logto-1', status: 'active' };
  const organisation = { id: 'org-1', logtoOrganisationId: 'lo-1', status: 'active' };
  const memberships = [{ id: 'm-1', identityId: 'ti-1', organisationId: 'org-1', role: 'admin', status: 'active', revision: 1 }];
  const entitlements = entitled ? [{ id: 'e-1', organisationId: 'org-1', applicationId: 'field', status: 'active', features: ['jobs:read'], revision: 1 }] : [];
  const links = [{ id: 'l-1', identityId: 'ti-1', organisationId: 'org-1', applicationId: 'field', localUserId: 'fu-1', localAccountId: 'fa-1', status: 'verified', verifiedAt: now, revision: 1 }];
  const repo = {
    identityBySubject: async (s) => (identity.logtoSubject === s ? identity : undefined),
    organisation: async (id) => (organisation.id === id ? organisation : undefined),
    memberships: async (id, org) => memberships.filter((m) => m.identityId === id && m.organisationId === org),
    entitlements: async (org, app) => entitlements.filter((e) => e.organisationId === org && e.applicationId === app),
    localLinks: async (id, org, app) => links.filter((l) => l.identityId === id && l.organisationId === org && l.applicationId === app),
  };
  const principal = { logtoSubject: 'logto-1', issuer: 'https://auth.titan.test/oidc', audience: 'field-client', verifiedAt: now };
  const trust = { expectedIssuer: principal.issuer, audienceByApplication: { field: 'field-client', desk: 'desk-client', academy: 'academy-client' } };
  return { service: new CentralAccessService(repo, trust), request: { principal, organisationId: 'org-1', applicationId: 'field', action: 'jobs:read', now } };
}

test('a matching repository identity does not grant access: the decision is unchanged by it', async () => {
  const reg = registry();
  const identity = repositoryIdentity(reg, 'Masterleeaus/Sorted');
  assert.equal(identity.accessGranted, false);
  const { service, request } = accessFixture({ entitled: false });
  const decision = await service.authorise(request);
  assert.deepEqual(decision, { allowed: false, reason: 'entitlement_missing' });
});

test('a repository name cannot be passed in place of an application id', async () => {
  const { service, request } = accessFixture({ entitled: true });
  const decision = await service.authorise({ ...request, applicationId: 'Masterleeaus/Sorted' });
  assert.equal(decision.allowed, false);
});

test('a canonical product id is not an access id: sorted is denied where field is allowed', async () => {
  const { service, request } = accessFixture({ entitled: true });
  assert.equal((await service.authorise(request)).allowed, true);
  const decision = await service.authorise({ ...request, applicationId: 'sorted' });
  assert.equal(decision.allowed, false);
});

test('failing health probes do not change access decisions', async () => {
  const reg = registry();
  const { service, request } = accessFixture({ entitled: true });
  const before = await service.authorise(request);
  const failing = async () => { throw new Error('connection refused'); };
  for (const product of reg) await probeProduct(product, { fetch: failing, timeoutMs: 20 });
  const after = await service.authorise(request);
  assert.deepEqual(after, before);
  assert.equal(after.allowed, true);
});

test('plan lookup shows the canonical id beside the legacy id, with origins from the registry', () => {
  const lookup = planLookup(registry());
  assert.deepEqual(lookup.field, { productId: 'sorted', legacyId: 'field', displayName: 'Sorted', serviceOrigin: ORIGINS.sorted });
  assert.deepEqual(lookup.desk, { productId: 'supercharged', legacyId: 'desk', displayName: 'Supercharged', serviceOrigin: ORIGINS.supercharged });
  assert.deepEqual(lookup.academy, { productId: 'lms', legacyId: 'academy', displayName: 'LMS', serviceOrigin: ORIGINS.lms });
  assert.throws(() => { lookup.field.serviceOrigin = 'https://evil.titanzero.io'; }, TypeError);
});

test('plan lookup and origin helper fail when any product has no validated origin', () => {
  const partial = buildProductRegistry({ serviceOrigins: { sorted: ORIGINS.sorted }, trustedOrigins: [ORIGINS.sorted] });
  assert.throws(() => planLookup(partial), (e) => e instanceof ProductRegistryError && e.code === 'missing_origin');
  assert.throws(() => originsForLegacyIds(partial), (e) => e instanceof ProductRegistryError && e.code === 'missing_origin');
});

test('legacy-keyed origins are exactly the registry origins', () => {
  assert.deepEqual({ ...originsForLegacyIds(registry()) }, { field: ORIGINS.sorted, desk: ORIGINS.supercharged, academy: ORIGINS.lms });
  assert.equal(resolveProduct(registry(), 'lms').serviceOrigin, ORIGINS.lms);
});
