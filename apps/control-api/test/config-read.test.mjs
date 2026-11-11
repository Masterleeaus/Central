import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createFlagRegistry, trustVerifiedContext } from '../../../packages/control-plane/dist/index.js';
import {
  createConfigReadHandler, createServiceIdentityVerifier, verifiedContextFromClaims, productAudience,
  ORGANISATION_CLAIM, COHORT_CLAIM,
} from '../src/config-read.mjs';
import { createOidcVerifier } from '../src/oidc.mjs';
import { readConfigProducts } from '../src/server.mjs';
import { memoryFlagStore, seedRow } from './support/flag-memory-store.mjs';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';
const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

const registry = createFlagRegistry([
  { product: 'sorted', key: 'bulk_export', owner: 'sorted-team', spec: { type: 'boolean' }, default: false },
  { product: 'lms', key: 'max_rows', owner: 'lms-team', spec: { type: 'integer', min: 1, max: 500 }, default: 50 },
]);

/** Token -> verified identity. The fake stands in for createServiceIdentityVerifier with verified claims. */
const identities = {
  'tok-sorted-a': { product: 'sorted', logtoSubject: 'svc-sorted', context: trustVerifiedContext({ organisationId: ORG_A }) },
  'tok-sorted-global': { product: 'sorted', logtoSubject: 'svc-sorted', context: trustVerifiedContext({ organisationId: null }) },
  'tok-lms-a': { product: 'lms', logtoSubject: 'svc-lms', context: trustVerifiedContext({ organisationId: ORG_A }) },
  'tok-bogus-product': { product: 'bogus', logtoSubject: 'svc-x', context: trustVerifiedContext({ organisationId: ORG_A }) },
};
const verifyServiceToken = async token => {
  if (!Object.hasOwn(identities, token)) throw new Error('bad token');
  return identities[token];
};

async function start(handlerOpts) {
  const handler = createConfigReadHandler({ verifyServiceToken, registry, ...handlerOpts });
  const server = createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(r => server.close(r)) };
}

const get = (base, path, token) => fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('valid read returns value, source and revision for the verified organisation', async () => {
  const store = memoryFlagStore();
  seedRow(registry, { product: 'sorted', environment: 'production', key: 'bulk_export', value: true }, store);
  const srv = await start({ store });
  try {
    const res = await get(srv.base, '/internal/v1/config/production/bulk_export', 'tok-sorted-a');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { key: 'bulk_export', value: true, source: 'global', revision: 1 });
  } finally { await srv.close(); }
});

test('an organisation override in the store applies to the token organisation only', async () => {
  const store = memoryFlagStore();
  seedRow(registry, { product: 'sorted', environment: 'production', key: 'bulk_export', value: false }, store);
  seedRow(registry, { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: ORG_A, value: true, expiresAt: FUTURE, revision: 2 }, store);
  const srv = await start({ store });
  try {
    const a = await (await get(srv.base, '/internal/v1/config/production/bulk_export', 'tok-sorted-a')).json();
    assert.deepEqual(a, { key: 'bulk_export', value: true, source: 'override', revision: 2 });
    const g = await (await get(srv.base, '/internal/v1/config/production/bulk_export', 'tok-sorted-global')).json();
    assert.equal(g.source, 'global');
    assert.equal(g.value, false);
  } finally { await srv.close(); }
});

test('organisation comes from the token, never a query parameter', async () => {
  const store = memoryFlagStore();
  seedRow(registry, { product: 'sorted', environment: 'production', key: 'bulk_export', organisationId: ORG_B, value: true, expiresAt: FUTURE }, store);
  const srv = await start({ store });
  try {
    for (const q of [`?organisation_id=${ORG_B}`, `?organisationId=${ORG_B}`, '?tenant=x', '?cohort=beta']) {
      const res = await get(srv.base, `/internal/v1/config/production/bulk_export${q}`, 'tok-sorted-a');
      assert.equal(res.status, 400, q);
      assert.equal((await res.json()).error, 'unexpected_parameter');
    }
    assert.equal(store.reads, 0, 'a request with a query parameter never reaches the store');
    // Without a query, the token organisation (A) is used, not B which the client named.
    const ok = await get(srv.base, '/internal/v1/config/production/bulk_export', 'tok-sorted-a');
    assert.equal((await ok.json()).source, 'default');
    assert.deepEqual(store.queriedOrganisations, [ORG_A]);
  } finally { await srv.close(); }
});

test('unknown flag key is refused with 404 undeclared_flag', async () => {
  const srv = await start({ store: memoryFlagStore() });
  try {
    const res = await get(srv.base, '/internal/v1/config/production/not_declared', 'tok-sorted-a');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'undeclared_flag' });
    const cross = await get(srv.base, '/internal/v1/config/production/max_rows', 'tok-sorted-a');
    assert.equal(cross.status, 404, 'a key declared for lms is not readable by sorted');
  } finally { await srv.close(); }
});

test('unknown product named by the verified identity is refused with 403', async () => {
  const store = memoryFlagStore();
  const srv = await start({ store });
  try {
    const res = await get(srv.base, '/internal/v1/config/production/bulk_export', 'tok-bogus-product');
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'unknown_product' });
    assert.equal(store.reads, 0);
  } finally { await srv.close(); }
});

test('store down returns the declared default with source fallback, not an error', async () => {
  const store = memoryFlagStore();
  store.failReads = true;
  const srv = await start({ store });
  try {
    const res = await get(srv.base, '/internal/v1/config/production/bulk_export', 'tok-sorted-a');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { key: 'bulk_export', value: false, source: 'fallback', revision: null });
  } finally { await srv.close(); }
});

test('a store read that exceeds the deadline also returns the declared default', async () => {
  const store = memoryFlagStore();
  store.readScopes = () => new Promise(() => {});
  const srv = await start({ store, storeTimeoutMs: 20 });
  try {
    const body = await (await get(srv.base, '/internal/v1/config/production/max_rows', 'tok-lms-a')).json();
    assert.deepEqual(body, { key: 'max_rows', value: 50, source: 'fallback', revision: null });
  } finally { await srv.close(); }
});

test('invalid stored row resolves to the declared default', async () => {
  const store = memoryFlagStore();
  seedRow(registry, { product: 'lms', environment: 'production', key: 'max_rows', value: 9999 }, store);
  const srv = await start({ store });
  try {
    const body = await (await get(srv.base, '/internal/v1/config/production/max_rows', 'tok-lms-a')).json();
    assert.equal(body.source, 'fallback');
    assert.equal(body.value, 50);
  } finally { await srv.close(); }
});

test('missing or unverifiable token is refused with 401 and nothing is read', async () => {
  const store = memoryFlagStore();
  const srv = await start({ store });
  try {
    assert.equal((await get(srv.base, '/internal/v1/config/production/bulk_export')).status, 401);
    const bad = await get(srv.base, '/internal/v1/config/production/bulk_export', 'tok-unknown');
    assert.equal(bad.status, 401);
    assert.equal(store.reads, 0);
  } finally { await srv.close(); }
});

test('invalid environment, invalid key and wrong method are refused', async () => {
  const srv = await start({ store: memoryFlagStore() });
  try {
    assert.equal((await get(srv.base, '/internal/v1/config/prod/bulk_export', 'tok-sorted-a')).status, 400);
    assert.equal((await get(srv.base, '/internal/v1/config/production/Bad-Key', 'tok-sorted-a')).status, 400);
    assert.equal((await get(srv.base, '/internal/v1/config/production/', 'tok-sorted-a')).status, 404);
    const post = await fetch(`${srv.base}/internal/v1/config/production/bulk_export`, { method: 'POST', headers: { authorization: 'Bearer tok-sorted-a' } });
    assert.equal(post.status, 405);
  } finally { await srv.close(); }
});

test('claims map to the verified context: organisation, global scope and cohorts', () => {
  assert.deepEqual(verifiedContextFromClaims({}).organisationId, null);
  assert.equal(verifiedContextFromClaims({ [ORGANISATION_CLAIM]: ORG_A.toUpperCase() }).organisationId, ORG_A);
  assert.deepEqual(verifiedContextFromClaims({ [COHORT_CLAIM]: ['beta', 'pilot-1'] }).cohorts, ['beta', 'pilot-1']);
  assert.throws(() => verifiedContextFromClaims({ [ORGANISATION_CLAIM]: 'not-a-uuid' }), /organisation claim/);
  assert.throws(() => verifiedContextFromClaims({ [ORGANISATION_CLAIM]: 42 }), /organisation claim/);
  assert.throws(() => verifiedContextFromClaims({ [COHORT_CLAIM]: 'beta' }), /cohort claim/);
  assert.throws(() => verifiedContextFromClaims({ [COHORT_CLAIM]: ['Bad Cohort'] }), /cohort claim/);
  assert.equal(productAudience('sorted'), 'urn:titan-central:product:sorted');
  assert.throws(() => productAudience('central-admin'), /unknown product/);
});

test('environment separation: a value for one environment is not served to another', async () => {
  const store = memoryFlagStore();
  seedRow(registry, { product: 'sorted', environment: 'production', key: 'bulk_export', value: true }, store);
  const srv = await start({ store });
  try {
    const prod = await (await get(srv.base, '/internal/v1/config/production/bulk_export', 'tok-sorted-a')).json();
    const staging = await (await get(srv.base, '/internal/v1/config/staging/bulk_export', 'tok-sorted-a')).json();
    assert.deepEqual([prod.value, prod.source], [true, 'global']);
    assert.deepEqual([staging.value, staging.source, staging.revision], [false, 'default', null]);
  } finally { await srv.close(); }
});

test('TITAN_CONFIG_READ_PRODUCTS: unset is off, known products only, no duplicates', () => {
  assert.deepEqual(readConfigProducts({}), []);
  assert.deepEqual(readConfigProducts({ TITAN_CONFIG_READ_PRODUCTS: 'sorted, lms' }), ['sorted', 'lms']);
  assert.throws(() => readConfigProducts({ TITAN_CONFIG_READ_PRODUCTS: 'sorted,bogus' }), /invalid TITAN_CONFIG_READ_PRODUCTS/);
  assert.throws(() => readConfigProducts({ TITAN_CONFIG_READ_PRODUCTS: 'lms,lms' }), /invalid TITAN_CONFIG_READ_PRODUCTS/);
});

test('real RS256 path: product from audience, organisation from the signed claim', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const issuer = 'https://issuer.example.test';
  const jwksUri = 'https://issuer.example.test/jwks';
  const fetcher = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const mint = (aud, extra = {}) => {
    const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const now = Math.floor(Date.now() / 1000);
    const p = b64({ iss: issuer, aud, sub: 'svc-sorted', iat: now, exp: now + 300, ...extra });
    const sig = cryptoSign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
    return `${h}.${p}.${sig}`;
  };
  const verifier = createServiceIdentityVerifier(new Map([['sorted', createOidcVerifier({
    issuer, audience: productAudience('sorted'), jwksUri, fetcher, claimNames: [ORGANISATION_CLAIM, COHORT_CLAIM], allowInsecureLocalhost: false,
  })]]));
  const id = await verifier(mint(productAudience('sorted'), { [ORGANISATION_CLAIM]: ORG_A, [COHORT_CLAIM]: ['beta'] }));
  assert.equal(id.product, 'sorted');
  assert.equal(id.context.organisationId, ORG_A);
  assert.deepEqual(id.context.cohorts, ['beta']);
  // A token for a different product audience is not accepted by the sorted verifier.
  await assert.rejects(verifier(mint(productAudience('lms'))));
  // A malformed organisation claim makes the token unauthenticated.
  await assert.rejects(verifier(mint(productAudience('sorted'), { [ORGANISATION_CLAIM]: 'org-a' })));
});
