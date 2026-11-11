import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadConfigFile, ConfigError, PRODUCT_TO_LEGACY } from '../src/config.mjs';

const base = () => ({
  centralOrigin: 'https://central.example.test',
  signIn: { applicationId: null },
  organisationSwitch: null,
  timeoutMs: 5000,
  products: [
    { id: 'sorted', legacyApplication: 'field', displayName: 'Sorted', url: 'https://sorted.example.test' },
    { id: 'supercharged', legacyApplication: 'desk', displayName: 'Supercharged', url: 'https://supercharged.example.test' },
    { id: 'lms', legacyApplication: 'academy', displayName: 'LMS', url: 'https://lms.example.test' },
  ],
});
const problemsOf = (raw) => {
  try { loadConfig(raw); return []; } catch (error) {
    assert.ok(error instanceof ConfigError, 'expected ConfigError');
    return error.problems;
  }
};

test('the shipped config/launcher.json validates and lists the three products in order', () => {
  const config = loadConfigFile(fileURLToPath(new URL('../config/launcher.json', import.meta.url)));
  assert.deepEqual(config.products.map((p) => p.id), ['sorted', 'supercharged', 'lms']);
  assert.deepEqual(config.products.map((p) => p.legacyApplication), ['field', 'desk', 'academy']);
  assert.equal(config.signIn.applicationId, null, 'sign-in stays disabled until a launcher OIDC application is registered');
});

test('product legacy mapping matches the #29 registry mapping', () => {
  assert.deepEqual({ ...PRODUCT_TO_LEGACY }, { sorted: 'field', supercharged: 'desk', lms: 'academy' });
});

test('a valid config is returned frozen with normalised URLs', () => {
  const config = loadConfig(base());
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.products));
  assert.equal(config.products[0].url, 'https://sorted.example.test/');
});

test('rejects a non-https product destination', () => {
  const raw = base();
  raw.products[0].url = 'http://sorted.example.test';
  assert.ok(problemsOf(raw).some((p) => p.includes('sorted.url')));
});

test('allows plain http only for localhost development hosts', () => {
  const raw = base();
  raw.products[0].url = 'http://localhost:4000';
  assert.equal(loadConfig(raw).products[0].url, 'http://localhost:4000/');
});

test('rejects javascript:, data: and credential-bearing URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'https://user:pass@sorted.example.test']) {
    const raw = base();
    raw.products[0].url = url;
    assert.ok(problemsOf(raw).some((p) => p.includes('sorted.url')), `should reject ${url}`);
  }
});

test('rejects a central origin that carries a path or query', () => {
  const raw = base();
  raw.centralOrigin = 'https://central.example.test/v1';
  assert.ok(problemsOf(raw).some((p) => p.startsWith('centralOrigin')));
});

test('rejects a missing product and a duplicate product', () => {
  const missing = base();
  missing.products.pop();
  assert.ok(problemsOf(missing).includes('missing product lms'));
  const duplicate = base();
  duplicate.products[2] = { ...duplicate.products[0] };
  assert.ok(problemsOf(duplicate).includes('duplicate product sorted'));
});

test('rejects a product mapped to the wrong legacy application', () => {
  const raw = base();
  raw.products[0].legacyApplication = 'desk';
  assert.ok(problemsOf(raw).includes('sorted.legacyApplication must be field'));
});

test('rejects an unknown product id, such as a stage name', () => {
  const raw = base();
  raw.products[0].id = 'sorted-staging';
  assert.ok(problemsOf(raw).some((p) => p.startsWith('unknown product id')));
});

test('rejects a sign-in application that has no control-api start route', () => {
  const raw = base();
  raw.signIn.applicationId = 'launcher';
  assert.ok(problemsOf(raw).some((p) => p.startsWith('signIn.applicationId')));
});

test('accepts an existing application for sign-in', () => {
  const raw = base();
  raw.signIn.applicationId = 'field';
  assert.equal(loadConfig(raw).signIn.applicationId, 'field');
});

test('organisationSwitch must be a safe URL when set', () => {
  const raw = base();
  raw.organisationSwitch = { url: 'javascript:void(0)' };
  assert.ok(problemsOf(raw).some((p) => p.startsWith('organisationSwitch.url')));
  raw.organisationSwitch = { url: 'https://central.example.test/organisations/select' };
  assert.equal(loadConfig(raw).organisationSwitch.url, 'https://central.example.test/organisations/select');
});

test('timeoutMs is bounded', () => {
  const raw = base();
  raw.timeoutMs = 10;
  assert.ok(problemsOf(raw).some((p) => p.startsWith('timeoutMs')));
});

test('reports every problem in one pass', () => {
  const raw = base();
  raw.centralOrigin = 'http://central.example.test';
  raw.products[1].url = 'ftp://x';
  assert.ok(problemsOf(raw).length >= 2);
});

test('rejects non-object configuration', () => {
  assert.ok(problemsOf(null).length === 1);
  assert.ok(problemsOf([]).length === 1);
});
