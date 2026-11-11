import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_DEFINITIONS,
  buildProductRegistry,
  findDefinitionProblems,
  normaliseTrustedOrigin,
  resolveProduct,
  resolveLegacyId,
  toCanonicalProductId,
  toLegacyApplicationId,
  repositoryIdentity,
  checkTenantReference,
  inspectProductContract,
  allApplications,
  ProductRegistryError,
  LEGACY_TO_PRODUCT,
} from '../dist/index.js';

const SORTED = 'https://sorted.titanzero.io';
const SUPER = 'https://supercharged.titanzero.io';
const LMS = 'https://lms.titanzero.io';
const allowlist = [SORTED, SUPER, LMS];
const fullConfig = { serviceOrigins: { sorted: SORTED, supercharged: SUPER, lms: LMS }, trustedOrigins: allowlist };
const registry = () => buildProductRegistry(fullConfig);
const clone = () => structuredClone(PRODUCT_DEFINITIONS);
const expectCode = (fn, code) => assert.throws(fn, (e) => e instanceof ProductRegistryError && e.code === code);

// Definitions

test('default definitions are valid and cover all three products', () => {
  assert.deepEqual(findDefinitionProblems(PRODUCT_DEFINITIONS), []);
  assert.deepEqual(PRODUCT_DEFINITIONS.map((p) => p.id), ['sorted', 'supercharged', 'lms']);
});

test('registry without operator origins leaves serviceOrigin null', () => {
  const reg = buildProductRegistry({ serviceOrigins: {}, trustedOrigins: [] });
  assert.equal(reg.length, 3);
  assert.ok(reg.every((p) => p.serviceOrigin === null));
});

test('rejects unknown product id in definitions', () => {
  const defs = clone();
  defs[0].id = 'desk';
  expectCode(() => buildProductRegistry(fullConfig, defs), 'unknown_product');
});

test('rejects a missing canonical product', () => {
  const defs = clone().slice(0, 2);
  assert.ok(findDefinitionProblems(defs).some((p) => p.code === 'missing_product'));
});

test('rejects duplicate product ids', () => {
  const defs = clone();
  defs[1].id = 'sorted';
  assert.ok(findDefinitionProblems(defs).some((p) => p.code === 'duplicate_id'));
});

test('rejects unknown legacy ids', () => {
  const defs = clone();
  defs[0].legacyId = 'wallet';
  assert.ok(findDefinitionProblems(defs).some((p) => p.code === 'unknown_legacy_id'));
});

test('rejects a legacy id mapped to the wrong product', () => {
  const defs = clone();
  defs[0].legacyId = 'desk';
  const codes = findDefinitionProblems(defs).map((p) => p.code);
  assert.ok(codes.includes('legacy_mapping_mismatch'));
});

test('rejects duplicate legacy ids', () => {
  const defs = clone();
  defs[1].legacyId = 'field';
  defs[1].id = 'supercharged';
  assert.ok(findDefinitionProblems(defs).some((p) => p.code === 'duplicate_legacy_id'));
});

test('rejects duplicate audiences', () => {
  const defs = clone();
  defs[1].audience = defs[0].audience;
  assert.ok(findDefinitionProblems(defs).some((p) => p.code === 'duplicate_audience'));
});

test('rejects duplicate repository identities', () => {
  const defs = clone();
  defs[2].repository = { ...defs[0].repository };
  assert.ok(findDefinitionProblems(defs).some((p) => p.code === 'duplicate_repository'));
});

test('rejects malformed contract versions', () => {
  for (const v of ['0.1', 'latest', '1.0.0-beta', 'v1.0.0']) {
    const defs = clone();
    defs[0].contractVersion = v;
    assert.ok(findDefinitionProblems(defs).some((p) => p.code === 'invalid_contract_version'), v);
  }
});

test('rejects a product that omits a required capability', () => {
  const defs = clone();
  defs[0].capabilities = defs[0].capabilities.filter((c) => c !== 'tenant-link:verify');
  expectCode(() => buildProductRegistry(fullConfig, defs), 'missing_required_capability');
});

test('rejects a tenant key that does not match the product', () => {
  const defs = clone();
  defs[2].tenantKey = { kind: 'sorted.account_id', field: 'account_id' };
  expectCode(() => buildProductRegistry(fullConfig, defs), 'invalid_tenant_key');
});

// Origins

test('accepts a normal HTTPS origin and normalises it', () => {
  assert.equal(normaliseTrustedOrigin('https://sorted.titanzero.io/'), 'https://sorted.titanzero.io');
});

test('rejects untrusted origins', () => {
  const bad = [
    'not a url',
    'http://sorted.titanzero.io',
    'https://user:pass@sorted.titanzero.io',
    'https://sorted.titanzero.io/api',
    'https://sorted.titanzero.io?x=1',
    'https://sorted.titanzero.io#frag',
    'https://sorted.titanzero.io:8443',
    'https://localhost',
    'https://api.localhost',
    'https://10.0.0.5',
    'https://127.0.0.1',
    'https://[::1]',
    'https://masterleeaus.github.io',
    'https://sorted.github.com',
    'https://raw.githubusercontent.com',
    'https://intranet',
  ];
  for (const url of bad) {
    expectCode(() => normaliseTrustedOrigin(url), 'untrusted_origin');
  }
});

test('origin not on the operator allowlist is rejected', () => {
  const cfg = { serviceOrigins: { sorted: 'https://evil.titanzero.io' }, trustedOrigins: allowlist };
  expectCode(() => buildProductRegistry(cfg), 'untrusted_origin');
});

test('origin is never derived from repository name', () => {
  const cfg = { serviceOrigins: { sorted: 'https://masterleeaus.github.io/Sorted' }, trustedOrigins: ['https://masterleeaus.github.io'] };
  expectCode(() => buildProductRegistry(cfg), 'untrusted_origin');
  const reg = buildProductRegistry({ serviceOrigins: {}, trustedOrigins: [] });
  assert.equal(resolveProduct(reg, 'sorted').serviceOrigin, null);
});

test('duplicate origins across products are rejected', () => {
  const cfg = { serviceOrigins: { sorted: SORTED, supercharged: SORTED }, trustedOrigins: allowlist };
  expectCode(() => buildProductRegistry(cfg), 'duplicate_origin');
});

test('origin configured for an unknown product key is rejected', () => {
  const cfg = { serviceOrigins: { field: SORTED }, trustedOrigins: allowlist };
  expectCode(() => buildProductRegistry(cfg), 'unknown_product');
});

test('configured origins are attached to the registered products', () => {
  const reg = registry();
  assert.equal(resolveProduct(reg, 'lms').serviceOrigin, LMS);
});

// Lookups and repository identity

test('unknown and legacy values are rejected as product ids', () => {
  const reg = registry();
  for (const v of ['field', 'desk', 'academy', 'Sorted', 'toString', '__proto__', undefined, 42, null]) {
    expectCode(() => resolveProduct(reg, v), 'unknown_product');
  }
});

test('a repository match is identity only and grants no access', () => {
  const reg = registry();
  const id = repositoryIdentity(reg, 'Masterleeaus/Sorted');
  assert.equal(id.accessGranted, false);
  assert.equal(id.product.id, 'sorted');
  assert.equal(repositoryIdentity(reg, 'Masterleeaus/Skilled').product.id, 'lms');
  assert.equal(repositoryIdentity(reg, 'Masterleeaus/Unknown'), undefined);
});

test('a repository name cannot be used as a product id', () => {
  expectCode(() => resolveProduct(registry(), 'Masterleeaus/Sorted'), 'unknown_product');
});

// Tenant checks

test('tenant reference must match the verified key', () => {
  assert.deepEqual(checkTenantReference('acc-1', 'acc-1'), { ok: true });
  assert.deepEqual(checkTenantReference('acc-1', 'acc-2'), { ok: false, code: 'cross_tenant' });
  assert.deepEqual(checkTenantReference(undefined, 'acc-2'), { ok: false, code: 'missing_tenant' });
  assert.deepEqual(checkTenantReference('acc-1', ''), { ok: false, code: 'missing_tenant' });
});

// Legacy mapping

test('legacy mapping covers exactly the ids in applications.ts', () => {
  const legacyIds = allApplications().map((a) => a.id).sort();
  assert.deepEqual(Object.keys(LEGACY_TO_PRODUCT).sort(), legacyIds);
  assert.deepEqual(legacyIds, ['academy', 'desk', 'field']);
});

test('legacy ids map to canonical products as documented', () => {
  assert.equal(toCanonicalProductId('field'), 'sorted');
  assert.equal(toCanonicalProductId('desk'), 'supercharged');
  assert.equal(toCanonicalProductId('academy'), 'lms');
});

test('legacy mapping round-trips', () => {
  for (const legacy of ['field', 'desk', 'academy']) {
    assert.equal(toLegacyApplicationId(toCanonicalProductId(legacy)), legacy);
  }
});

test('resolveLegacyId returns the registered product and rejects other values', () => {
  const reg = registry();
  assert.equal(resolveLegacyId(reg, 'academy').id, 'lms');
  for (const v of ['sorted', 'toString', 'constructor', undefined]) {
    expectCode(() => resolveLegacyId(reg, v), 'unknown_legacy_id');
  }
});

test('legacy application ids are unchanged by the registry', () => {
  assert.deepEqual(allApplications().map((a) => a.label), ['Titan Field', 'Titan Desk', 'Titan Academy']);
});

// Contract inspection

test('inspection passes when version and capabilities match', () => {
  const sorted = resolveProduct(registry(), 'sorted');
  const result = inspectProductContract(sorted, { contractVersion: sorted.contractVersion, capabilities: sorted.capabilities });
  assert.deepEqual(result, { productId: 'sorted', compatible: true, findings: [] });
});

test('inspection reports missing and mismatched contract versions', () => {
  const sorted = resolveProduct(registry(), 'sorted');
  const missing = inspectProductContract(sorted, { contractVersion: undefined, capabilities: sorted.capabilities });
  assert.equal(missing.compatible, false);
  assert.equal(missing.findings[0].code, 'contract_version_missing');
  const mismatch = inspectProductContract(sorted, { contractVersion: '0.2.0-draft', capabilities: sorted.capabilities });
  assert.equal(mismatch.findings[0].code, 'contract_version_mismatch');
});

test('inspection reports missing required and undeclared capabilities', () => {
  const lms = resolveProduct(registry(), 'lms');
  const result = inspectProductContract(lms, {
    contractVersion: lms.contractVersion,
    capabilities: ['health', 'version', 'jobs:read'],
  });
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes('missing_capability'));
  assert.ok(codes.includes('undeclared_capability'));
  assert.equal(result.compatible, false);
});

test('inspection is pure: it does not mutate its inputs', () => {
  const lms = resolveProduct(registry(), 'lms');
  const config = { contractVersion: lms.contractVersion, capabilities: [...lms.capabilities] };
  const snapshot = structuredClone({ lms, config });
  inspectProductContract(lms, config);
  assert.deepEqual({ lms, config }, snapshot);
});
