import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readOperatorConfig, createOperatorAdmin } from '../src/operator-config.mjs';
import { createMetrics } from '../src/metrics.mjs';

// Reads the active (uncommented) assignments of the shipped template. Values are placeholders or the
// owner-provided non-secret IDs; the Logto client secret stays REPLACE_ME in the repository.
const template = readFileSync(new URL('../../../deploy/env.example', import.meta.url), 'utf8');
const fromTemplate = Object.fromEntries([...template.matchAll(/^(TITAN_[A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2]]));

const SECRET = 'fixture-m2m-secret-DO-NOT-LEAK-4a1f';
const OPERATOR_KEYS = ['TITAN_OPERATOR_ORGANISATION_ID', 'TITAN_OPERATOR_ROLE_IDS'];
const LOGTO_KEYS = [
  'TITAN_LOGTO_MANAGEMENT_ORIGIN', 'TITAN_LOGTO_M2M_CLIENT_ID', 'TITAN_LOGTO_M2M_CLIENT_SECRET',
  'TITAN_LOGTO_MANAGEMENT_RESOURCE', 'TITAN_LOGTO_MANAGEMENT_SCOPE',
];

// A complete operator example: owner-provided IDs, fixture Logto client values, fixture product origins.
const COMPLETE = {
  TITAN_CENTRAL_DATABASE_URL: 'postgres://unused.example.test/titan_central',
  TITAN_OIDC_ISSUER: 'https://issuer.example.test',
  TITAN_OIDC_JWKS_URI: 'https://issuer.example.test/jwks',
  TITAN_FIELD_AUDIENCE: 'aud-field', TITAN_DESK_AUDIENCE: 'aud-desk', TITAN_ACADEMY_AUDIENCE: 'aud-academy',
  TITAN_OPERATOR_ORGANISATION_ID: 'tc5p1zpq21uu',
  TITAN_OPERATOR_ROLE_IDS: 'wocrsarwp3tw2khe42kbi',
  TITAN_LOGTO_MANAGEMENT_ORIGIN: 'https://auth.titanzero.io',
  TITAN_LOGTO_M2M_CLIENT_ID: 'm2m-client-fixture',
  TITAN_LOGTO_M2M_CLIENT_SECRET: SECRET,
  TITAN_LOGTO_MANAGEMENT_RESOURCE: 'https://auth.titanzero.io/api',
  TITAN_LOGTO_MANAGEMENT_SCOPE: 'all',
  TITAN_FIELD_ORIGIN: 'https://field.example.test',
  TITAN_DESK_ORIGIN: 'https://desk.example.test',
  TITAN_ACADEMY_ORIGIN: 'https://academy.example.test',
  TITAN_PRODUCT_TRUSTED_ORIGINS: 'https://field.example.test,https://desk.example.test,https://academy.example.test',
};

test('the shipped template carries the owner-provided Logto resource and scope, not a secret', () => {
  assert.equal(fromTemplate.TITAN_LOGTO_MANAGEMENT_RESOURCE, 'https://auth.titanzero.io/api');
  assert.equal(fromTemplate.TITAN_LOGTO_MANAGEMENT_SCOPE, 'all');
  assert.equal(fromTemplate.TITAN_LOGTO_M2M_CLIENT_SECRET, 'REPLACE_ME');
  assert.equal(fromTemplate.TITAN_LOGTO_M2M_CLIENT_ID, 'REPLACE_ME');
  assert.equal(template.includes(SECRET), false);
});

test('a complete operator example reads back the operator IDs', () => {
  assert.deepEqual(readOperatorConfig(COMPLETE), {
    organisationId: 'tc5p1zpq21uu', roleIds: ['wocrsarwp3tw2khe42kbi'],
  });
});

test('the operator plane is off when neither operator ID is set, even with Logto values present', () => {
  const env = { ...COMPLETE, TITAN_OPERATOR_ORGANISATION_ID: '', TITAN_OPERATOR_ROLE_IDS: '' };
  assert.equal(readOperatorConfig(env), null);
});

test('the complete example builds the admin handler', () => {
  const handler = createOperatorAdmin({ env: COMPLETE, verifyToken: async () => ({}), metrics: createMetrics(), fetcher: async () => { throw new Error('no network in tests'); } });
  assert.equal(typeof handler, 'function');
});

for (const key of OPERATOR_KEYS) {
  test(`removing ${key} fails and names the pair without echoing values`, () => {
    const env = { ...COMPLETE };
    delete env[key];
    assert.throws(() => readOperatorConfig(env), (e) => {
      assert.match(e.message, /TITAN_OPERATOR_ORGANISATION_ID and TITAN_OPERATOR_ROLE_IDS must be set together/);
      assert.equal(e.message.includes('tc5p1zpq21uu') || e.message.includes('wocrsarwp3tw2khe42kbi'), false);
      return true;
    });
  });
}

for (const key of LOGTO_KEYS) {
  test(`a missing ${key} stops the operator plane at startup and names only that variable`, () => {
    const env = { ...COMPLETE };
    delete env[key];
    assert.throws(() => createOperatorAdmin({ env, verifyToken: async () => ({}), metrics: createMetrics(), fetcher: async () => ({}) }), (e) => {
      assert.match(e.message, new RegExp(key));
      assert.equal(e.message.includes(SECRET), false);
      return true;
    });
  });
}

test('a placeholder M2M secret stops startup', () => {
  const env = { ...COMPLETE, TITAN_LOGTO_M2M_CLIENT_SECRET: 'REPLACE_ME' };
  assert.throws(() => createOperatorAdmin({ env, verifyToken: async () => ({}), metrics: createMetrics(), fetcher: async () => ({}) }), /TITAN_LOGTO_M2M_CLIENT_SECRET/);
});

test('tenant-administrator role IDs (#34 mutations): owner must supply the values', { todo: 'needs the owner-provided tenant-administrator role IDs; no config key exists yet' }, () => {
  assert.fail('add a config test once TITAN_TENANT_ADMIN_ROLE_IDS (or the agreed name) is read by the code');
});
