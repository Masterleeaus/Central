import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadProductRegistry } from '../src/operator-config.mjs';
import { startCentralService } from '../src/server.mjs';
import { createAdminHandler } from '../src/admin.mjs';
import { createCentralHandler } from '../src/app.mjs';
import { originsForLegacyIds, buildProductRegistry } from '../../../packages/control-plane/dist/index.js';

const SORTED = 'https://sorted.titanzero.io';
const SUPER = 'https://supercharged.titanzero.io';
const LMS = 'https://lms.titanzero.io';
const ORG_ID = '00000000-0000-4000-8000-000000000001';
const FULL = {
  TITAN_FIELD_ORIGIN: SORTED,
  TITAN_DESK_ORIGIN: SUPER,
  TITAN_ACADEMY_ORIGIN: LMS,
  TITAN_PRODUCT_TRUSTED_ORIGINS: `${SORTED},${SUPER},${LMS}`,
};
const AUDIENCES = { field: 'aud-field', desk: 'aud-desk', academy: 'aud-academy' };

const codeOf = fn => { try { fn(); return undefined; } catch (e) { return e; } };

test('no product variables: empty registry, no origins, no error', () => {
  const reg = loadProductRegistry({});
  assert.equal(reg.length, 3);
  assert.ok(reg.every(p => p.serviceOrigin === null));
});

test('all three origins with an allowlist attach to the canonical products', () => {
  const reg = loadProductRegistry(FULL);
  const byId = Object.fromEntries(reg.map(p => [p.id, p.serviceOrigin]));
  assert.deepEqual(byId, { sorted: SORTED, supercharged: SUPER, lms: LMS });
  assert.deepEqual({ ...originsForLegacyIds(reg) }, { field: SORTED, desk: SUPER, academy: LMS });
});

test('an allowlist alone is accepted and attaches no origins', () => {
  const reg = loadProductRegistry({ TITAN_PRODUCT_TRUSTED_ORIGINS: `${SORTED}` });
  assert.ok(reg.every(p => p.serviceOrigin === null));
});

test('origins without the allowlist fail startup and name the variable', () => {
  const env = { ...FULL };
  delete env.TITAN_PRODUCT_TRUSTED_ORIGINS;
  assert.throws(() => loadProductRegistry(env), /TITAN_PRODUCT_TRUSTED_ORIGINS must be set/);
});

test('a partial set of origins fails startup and names the variables', () => {
  const env = { ...FULL };
  delete env.TITAN_ACADEMY_ORIGIN;
  assert.throws(() => loadProductRegistry(env), /TITAN_FIELD_ORIGIN, TITAN_DESK_ORIGIN, TITAN_ACADEMY_ORIGIN must be set together/);
});

test('an origin missing from the operator allowlist is rejected', () => {
  const env = { ...FULL, TITAN_PRODUCT_TRUSTED_ORIGINS: `${SORTED},${SUPER}` };
  const e = codeOf(() => loadProductRegistry(env));
  assert.equal(e.message.includes('(untrusted_origin)'), true);
});

test('duplicate origins across products are rejected', () => {
  const env = { ...FULL, TITAN_DESK_ORIGIN: SORTED };
  const e = codeOf(() => loadProductRegistry(env));
  assert.equal(e.message.includes('(duplicate_origin)'), true);
});

test('GitHub hosts, localhost, IP literals, http and paths are rejected as origins', () => {
  const bad = [
    'https://masterleeaus.github.io',
    'https://raw.githubusercontent.com',
    'https://localhost',
    'https://10.0.0.5',
    'http://sorted.titanzero.io',
    'https://sorted.titanzero.io/app',
    'REPLACE_ME',
  ];
  for (const value of bad) {
    const env = { ...FULL, TITAN_FIELD_ORIGIN: value, TITAN_PRODUCT_TRUSTED_ORIGINS: `${value},${SUPER},${LMS}` };
    assert.throws(() => loadProductRegistry(env), /invalid product origin configuration|invalid TITAN_PRODUCT_TRUSTED_ORIGINS/, value);
  }
});

test('an allowlist entry that is not a valid origin, or a placeholder, fails', () => {
  assert.throws(() => loadProductRegistry({ ...FULL, TITAN_PRODUCT_TRUSTED_ORIGINS: `${SORTED},,${SUPER}` }), /invalid TITAN_PRODUCT_TRUSTED_ORIGINS/);
  assert.throws(() => loadProductRegistry({ ...FULL, TITAN_PRODUCT_TRUSTED_ORIGINS: `${SORTED},REPLACE_ME` }), /invalid TITAN_PRODUCT_TRUSTED_ORIGINS/);
});

test('error messages never echo configured origin values', () => {
  const secretish = 'https://secret-host-value.titanzero.io/path-sentinel';
  const env = { ...FULL, TITAN_FIELD_ORIGIN: secretish, TITAN_PRODUCT_TRUSTED_ORIGINS: `${secretish},${SUPER},${LMS}` };
  const e = codeOf(() => loadProductRegistry(env));
  assert.ok(e instanceof Error);
  assert.ok(!e.message.includes('secret-host-value') && !e.message.includes('path-sentinel'));
});

test('the registry is built from the validated origins, not from the raw environment object', () => {
  const env = { ...FULL };
  const reg = loadProductRegistry(env);
  env.TITAN_FIELD_ORIGIN = 'https://changed.titanzero.io';
  assert.equal(originsForLegacyIds(reg).field, SORTED);
});

// Startup: invalid product origins fail even with the operator plane off.

const BASE = {
  TITAN_CENTRAL_DATABASE_URL: 'postgres://unused.example.test/titan_central',
  TITAN_OIDC_ISSUER: 'https://issuer.example.test',
  TITAN_OIDC_JWKS_URI: 'https://issuer.example.test/jwks',
  TITAN_FIELD_AUDIENCE: 'aud-field', TITAN_DESK_AUDIENCE: 'aud-desk', TITAN_ACADEMY_AUDIENCE: 'aud-academy',
};
class FakePool { async query() { return { rows: [] }; } async connect() { return { query: async () => ({ rows: [] }), release() {} }; } async end() {} }
const loadPg = async () => ({ Pool: FakePool });
function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }

test('startup with invalid product origins fails even when the operator plane is off', async () => {
  const port = await freePort();
  const env = { ...BASE, ...FULL, TITAN_DESK_ORIGIN: 'https://evil.example.test', TITAN_CENTRAL_PORT: String(port) };
  await assert.rejects(startCentralService({ env, loadPg, verifyToken: async () => ({ logtoSubject: 'x' }) }), /invalid product origin configuration \(untrusted_origin\)/);
});

test('startup with valid product origins and the operator plane off still serves health', async () => {
  const port = await freePort();
  const service = await startCentralService({ env: { ...BASE, ...FULL, TITAN_CENTRAL_PORT: String(port) }, loadPg, verifyToken: async () => ({ logtoSubject: 'x' }) });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
  } finally { await service.close(); }
});

// Plans view: canonical id next to legacy id, origins from the registry.

test('plans view labels each legacy application with its canonical product and registry origin', async () => {
  const reg = buildProductRegistry({ serviceOrigins: { sorted: SORTED, supercharged: SUPER, lms: LMS }, trustedOrigins: [SORTED, SUPER, LMS] });
  const handler = createAdminHandler({
    verifyToken: async () => ({ logtoSubject: 'op' }),
    authoriseOperator: async () => true,
    origins: originsForLegacyIds(reg),
    productRegistry: reg,
  });
  const pool = { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) };
  const server = createServer(createCentralHandler({ pool, verifyToken: async () => ({ logtoSubject: 'op' }), issuer: 'https://issuer.test', audiences: AUDIENCES, adminHandler: handler }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/admin/oidc/plans`, { headers: { authorization: 'Bearer abc.def.ghi' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    const byLegacy = Object.fromEntries(body.applications.map(a => [a.legacyId, a]));
    assert.equal(byLegacy.field.productId, 'sorted');
    assert.equal(byLegacy.desk.productId, 'supercharged');
    assert.equal(byLegacy.academy.productId, 'lms');
    assert.equal(byLegacy.field.origin, SORTED);
    assert.equal(byLegacy.field.redirectUris[0], `${SORTED}/auth/titan/field/callback`);
    assert.equal(byLegacy.academy.displayName, 'LMS');
  } finally { server.close(); await once(server, 'close'); }
});
