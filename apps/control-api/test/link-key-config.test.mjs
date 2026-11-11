import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readLinkKeySets, validateLinkKeySets, LINK_KEYS_FILE_VAR, LINK_KEYS_JSON_VAR } from '../src/link-key-config.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const X = publicKey.export({ format: 'jwk' }).x;
const SECRET_D = privateKey.export({ format: 'jwk' }).d;
const key = (over = {}) => ({ kid: 'sorted-2026-01', alg: 'EdDSA', jwk: { kty: 'OKP', crv: 'Ed25519', x: X }, notBefore: '2026-01-01T00:00:00.000Z', ...over });
const set = (over = {}) => ({ productId: 'sorted', keys: [key()], ...over });
const sets = (...s) => [...s];

/** Asserts the rule is named and no value from the configuration leaks into the message. */
function rejects(value, rule) {
  let message = '';
  try { validateLinkKeySets(value, 'TITAN_LINK_KEYS_JSON'); } catch (e) { message = e.message; }
  assert.ok(message.startsWith('TITAN_LINK_KEYS_JSON:'), `expected a rejection naming the variable, got: ${message}`);
  assert.match(message, rule);
  assert.ok(!message.includes(X), 'a public key value must not appear in an error');
  assert.ok(!message.includes(SECRET_D), 'private material must never appear in an error');
  return message;
}

test('unset or empty sources mean no key sets, so link provisioning stays disabled', () => {
  assert.equal(readLinkKeySets({}), null);
  assert.equal(readLinkKeySets({ [LINK_KEYS_FILE_VAR]: '', [LINK_KEYS_JSON_VAR]: '' }), null);
});

test('the file and inline sources are mutually exclusive', () => {
  assert.throws(() => readLinkKeySets({ [LINK_KEYS_FILE_VAR]: '/x.json', [LINK_KEYS_JSON_VAR]: '[]' }), /set only one of TITAN_LINK_KEYS_FILE or TITAN_LINK_KEYS_JSON/);
});

test('a valid inline configuration returns normalised key sets', () => {
  const parsed = readLinkKeySets({ [LINK_KEYS_JSON_VAR]: JSON.stringify(sets(set({ keys: [key(), key({ kid: 'sorted-2026-11', notBefore: '2026-11-01T00:00:00Z', notAfter: '2027-01-01T00:00:00+00:00' })] }))) });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].productId, 'sorted');
  assert.deepEqual(parsed[0].keys[0].jwk, { kty: 'OKP', crv: 'Ed25519', x: X });
  assert.equal(parsed[0].keys[1].notAfter, '2027-01-01T00:00:00+00:00');
});

test('a valid file configuration is read once from the configured path', () => {
  const seen = [];
  const parsed = readLinkKeySets({ [LINK_KEYS_FILE_VAR]: '/etc/titan/link-keys.json' }, { readFile: (p) => { seen.push(p); return JSON.stringify(sets(set())); } });
  assert.deepEqual(seen, ['/etc/titan/link-keys.json']);
  assert.equal(parsed[0].keys.length, 1);
});

test('an unreadable file fails startup and names only the variable, not the path', () => {
  assert.throws(() => readLinkKeySets({ [LINK_KEYS_FILE_VAR]: '/secret/location.json' }, { readFile: () => { throw new Error('ENOENT /secret/location.json'); } }),
    (e) => e.message === 'TITAN_LINK_KEYS_FILE: file cannot be read');
});

test('content that is not JSON fails startup without echoing it', () => {
  assert.throws(() => readLinkKeySets({ [LINK_KEYS_JSON_VAR]: `[{"productId":"sorted",${X}` }), (e) => e.message === 'TITAN_LINK_KEYS_JSON: content is not valid JSON' && !e.message.includes(X));
});

test('the top level must be an array of one to three product entries', () => {
  rejects({ productId: 'sorted', keys: [key()] }, /must be an array/);
  rejects([], /must be an array/);
  rejects([set(), set({ productId: 'supercharged' }), set({ productId: 'lms' }), set({ productId: 'sorted' })], /must be an array/);
});

test('each entry must be an object with only productId and keys', () => {
  rejects(['sorted'], /products\[0\] must be an object/);
  rejects(sets(set({ extra: true })), /products\[0\] has unknown field "extra"/);
});

test('the product must be a known product, not a legacy application ID or a name', () => {
  rejects(sets(set({ productId: 'field' })), /productId must be a known product/);
  rejects(sets(set({ productId: 'Sorted Ltd' })), /productId must be a known product/);
  rejects(sets(set({ productId: undefined })), /productId must be a known product/);
});

test('a product may appear only once', () => {
  rejects(sets(set(), set({ keys: [key({ kid: 'other' })] })), /productId is listed more than once/);
});

test('each product holds one to eight keys', () => {
  rejects(sets(set({ keys: [] })), /keys must hold 1 to 8 keys/);
  rejects(sets(set({ keys: Array.from({ length: 9 }, (_, i) => key({ kid: `k${i}` })) })), /keys must hold 1 to 8 keys/);
});

test('each key holds only the documented fields, so a private key member cannot ride along', () => {
  rejects(sets(set({ keys: [key({ d: SECRET_D })] })), /keys\[0\] has unknown field "d"/);
});

test('key IDs are 1 to 64 safe characters and unique within a product', () => {
  rejects(sets(set({ keys: [key({ kid: '' })] })), /kid must be 1 to 64/);
  rejects(sets(set({ keys: [key({ kid: 'has space' })] })), /kid must be 1 to 64/);
  rejects(sets(set({ keys: [key({ kid: 'x'.repeat(65) })] })), /kid must be 1 to 64/);
  rejects(sets(set({ keys: [key(), key()] })), /kid is duplicated within its product/);
});

test('the algorithm must be EdDSA: missing, RS256 and none are refused', () => {
  for (const alg of [undefined, 'RS256', 'none', 'eddsa']) {
    rejects(sets(set({ keys: [key({ alg })] })), /alg must be EdDSA/);
  }
});

test('the key type must be an Ed25519 public OKP key', () => {
  rejects(sets(set({ keys: [key({ jwk: undefined })] })), /jwk must be an object/);
  rejects(sets(set({ keys: [key({ jwk: { kty: 'EC', crv: 'Ed25519', x: X } })] })), /jwk.kty must be OKP/);
  rejects(sets(set({ keys: [key({ jwk: { kty: 'OKP', crv: 'P-256', x: X } })] })), /jwk.crv must be Ed25519/);
  rejects(sets(set({ keys: [key({ jwk: { kty: 'OKP', crv: 'Ed25519', x: 'abc' } })] })), /jwk.x must be a 32-byte Ed25519 public key/);
  rejects(sets(set({ keys: [key({ jwk: { kty: 'OKP', crv: 'Ed25519', x: `${X}A` } })] })), /jwk.x must be a 32-byte Ed25519 public key/);
  rejects(sets(set({ keys: [key({ jwk: { kty: 'OKP', crv: 'Ed25519', x: X.replace(/./, '+') } })] })), /jwk.x must be a 32-byte Ed25519 public key/);
});

test('a JWK carrying private members is refused, whichever member it is', () => {
  rejects(sets(set({ keys: [key({ jwk: { kty: 'OKP', crv: 'Ed25519', x: X, d: SECRET_D } })] })), /jwk must hold only kty, crv and x \(found "d"\)/);
});

test('notBefore is required and must be an RFC 3339 time with an offset', () => {
  rejects(sets(set({ keys: [key({ notBefore: undefined })] })), /notBefore must be an RFC 3339 time with an offset/);
  rejects(sets(set({ keys: [key({ notBefore: '2026-01-01T00:00:00' })] })), /notBefore must be an RFC 3339 time with an offset/);
  rejects(sets(set({ keys: [key({ notBefore: 'yesterday' })] })), /notBefore must be an RFC 3339 time with an offset/);
  rejects(sets(set({ keys: [key({ notBefore: '2026-13-01T00:00:00Z' })] })), /notBefore must be an RFC 3339 time with an offset/);
});

test('notAfter is optional, but when present it must be RFC 3339 and later than notBefore', () => {
  rejects(sets(set({ keys: [key({ notAfter: '2026-06-01' })] })), /notAfter must be an RFC 3339 time with an offset/);
  rejects(sets(set({ keys: [key({ notAfter: 1767225600 })] })), /notAfter must be an RFC 3339 time with an offset/);
  rejects(sets(set({ keys: [key({ notAfter: '2026-01-01T00:00:00Z' })] })), /notAfter must be later than notBefore/);
  rejects(sets(set({ keys: [key({ notBefore: '2026-02-01T00:00:00Z', notAfter: '2026-01-01T00:00:00Z' })] })), /notAfter must be later than notBefore/);
  assert.equal(validateLinkKeySets(sets(set({ keys: [key({ notAfter: undefined })] })))[0].keys[0].notAfter, undefined);
});
