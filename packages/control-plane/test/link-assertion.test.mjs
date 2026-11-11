import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { LinkAssertionVerifier, LinkAssertionRejected } from '../dist/link-assertion.js';
import { makeProductKey, claimsFor, signClaims, memoryNonces, b64u, NOW, NOW_S, EXPECT_FIELD, ORG_B_LOGTO, LOCAL_ACCOUNT } from './support/link-signing.mjs';

const sorted = makeProductKey('sorted-2026-01');
const makeVerifier = ({ keys = [sorted.keyConfig], nonces = memoryNonces(), now = NOW } = {}) =>
  ({ nonces, verifier: new LinkAssertionVerifier([{ productId: 'sorted', keys }], nonces, () => now) });
const rejectsWith = (promise, code) => assert.rejects(promise, (e) => e instanceof LinkAssertionRejected && e.code === code, `expected ${code}`);

test('accepts a correctly signed, in-window assertion for the matching product', async () => {
  const { verifier } = makeVerifier();
  const token = signClaims(sorted, claimsFor());
  const result = await verifier.verify(token, EXPECT_FIELD);
  assert.equal(result.productId, 'sorted');
  assert.equal(result.expiresAt, new Date((NOW_S + 120) * 1000).toISOString());
});

test('rejects an unknown product', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ iss: 'mystery' })), EXPECT_FIELD), 'unknown_product');
});

test('rejects a known product with no key set configured', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ iss: 'lms' })), { ...EXPECT_FIELD, applicationId: 'academy' }), 'unknown_product');
});

test('cross-product: a Sorted assertion cannot link a Desk (Supercharged) account', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor()), { ...EXPECT_FIELD, applicationId: 'desk' }), 'product_mismatch');
});

test('rejects the wrong audience', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ aud: 'some-other-service' })), EXPECT_FIELD), 'wrong_audience');
});

test('rejects a tampered payload under the original signature', async () => {
  const { verifier } = makeVerifier();
  const [h, , s] = signClaims(sorted, claimsFor()).split('.');
  const forged = b64u(claimsFor({ la: 'acct-attacker' }));
  await rejectsWith(verifier.verify(`${h}.${forged}.${s}`, EXPECT_FIELD), 'bad_signature');
});

test('rejects a signature from a key that is not the product key', async () => {
  const { verifier } = makeVerifier();
  const other = makeProductKey('sorted-2026-01');
  await rejectsWith(verifier.verify(signClaims(other, claimsFor()), EXPECT_FIELD), 'bad_signature');
});

test('rejects alg none and HS256 without touching key material', async () => {
  const { verifier } = makeVerifier();
  const claims = b64u(claimsFor());
  await rejectsWith(verifier.verify(`${b64u({ alg: 'none', typ: 'titan-link+jwt', kid: sorted.kid })}.${claims}.AAAA`, EXPECT_FIELD), 'bad_algorithm');
  await rejectsWith(verifier.verify(`${b64u({ alg: 'none', typ: 'titan-link+jwt', kid: sorted.kid })}.${claims}.`, EXPECT_FIELD), 'malformed');
  await rejectsWith(verifier.verify(`${b64u({ alg: 'HS256', typ: 'titan-link+jwt', kid: sorted.kid })}.${claims}.AAAA`, EXPECT_FIELD), 'bad_algorithm');
});

test('rejects an unknown key id', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims({ ...sorted, kid: 'sorted-rogue' }, claimsFor()), EXPECT_FIELD), 'unknown_key');
});

test('rejects expired assertions, including exp equal to now', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ iat: NOW_S - 200, exp: NOW_S - 1 })), EXPECT_FIELD), 'expired');
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ iat: NOW_S - 120, exp: NOW_S })), EXPECT_FIELD), 'expired');
});

test('rejects future-dated assertions beyond the 30 second skew, and allows skew within it', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ iat: NOW_S + 60, exp: NOW_S + 180 })), EXPECT_FIELD), 'future_dated');
  await verifier.verify(signClaims(sorted, claimsFor({ iat: NOW_S + 10, exp: NOW_S + 130 })), EXPECT_FIELD);
});

test('rejects lifetimes longer than 300 seconds or not positive', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ exp: NOW_S + 301 })), EXPECT_FIELD), 'bad_lifetime');
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ exp: NOW_S })), EXPECT_FIELD), 'bad_lifetime');
});

test('rejects a missing required claim', async () => {
  const { verifier } = makeVerifier();
  const { nonce, ...withoutNonce } = claimsFor();
  await rejectsWith(verifier.verify(signClaims(sorted, withoutNonce), EXPECT_FIELD), 'missing_claim');
});

test('rejects a nonce that is too short to be unguessable', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ nonce: 'short' })), EXPECT_FIELD), 'malformed');
});

test('an email-only assertion is rejected', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, { iss: 'sorted', aud: 'titan-central', email: 'jane@example.com', nonce: claimsFor().nonce, iat: NOW_S, exp: NOW_S + 60 }), EXPECT_FIELD), 'forbidden_claim');
  await rejectsWith(verifier.verify(signClaims(sorted, { iss: 'sorted', aud: 'titan-central', nonce: claimsFor().nonce, iat: NOW_S, exp: NOW_S + 60, lu: 'jane@example.com', la: 'jane@example.com' }), EXPECT_FIELD), 'missing_claim');
});

test('an email or display name used as an identifier is rejected', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ sub: 'jane@example.com' })), { ...EXPECT_FIELD, logtoSubject: 'jane@example.com' }), 'identifier_not_permitted');
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ la: 'Jane Smith' })), { ...EXPECT_FIELD, localAccountId: 'Jane Smith' }), 'identifier_not_permitted');
});

test('identifiers must match the expected Central subject, organisation and local account', async () => {
  const { verifier } = makeVerifier();
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ sub: 'usr_otherperson' })), EXPECT_FIELD), 'subject_mismatch');
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ org: 'org_unrelated1' })), EXPECT_FIELD), 'organisation_mismatch');
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ la: 'acct-other-0002' })), EXPECT_FIELD), 'account_mismatch');
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor({ lu: 'user-other-0002' })), EXPECT_FIELD), 'account_mismatch');
});

test('replayed nonce is rejected, including a different token carrying the same nonce', async () => {
  const { verifier, nonces } = makeVerifier();
  const claims = claimsFor();
  await verifier.verify(signClaims(sorted, claims), EXPECT_FIELD);
  await rejectsWith(verifier.verify(signClaims(sorted, claims), EXPECT_FIELD), 'replayed');
  await rejectsWith(verifier.verify(signClaims(sorted, { ...claims, iat: NOW_S + 1, exp: NOW_S + 121 }), EXPECT_FIELD), 'replayed');
  assert.equal(nonces.size, 1);
});

test('a rejected assertion does not consume its nonce', async () => {
  const { verifier } = makeVerifier();
  const claims = claimsFor();
  await rejectsWith(verifier.verify(signClaims(sorted, claims), { ...EXPECT_FIELD, logtoOrganisationId: ORG_B_LOGTO }), 'organisation_mismatch');
  await verifier.verify(signClaims(sorted, claims), EXPECT_FIELD);
});

test('nonces are pruned once their assertion has expired, so the store stays within the replay window', async () => {
  const nonces = memoryNonces();
  const first = makeVerifier({ nonces, now: NOW }).verifier;
  await first.verify(signClaims(sorted, claimsFor({ iat: NOW_S, exp: NOW_S + 60 })), EXPECT_FIELD);
  assert.equal(nonces.size, 1);
  const later = makeVerifier({ nonces, now: new Date((NOW_S + 61) * 1000).toISOString() }).verifier;
  await later.verify(signClaims(sorted, claimsFor({ iat: NOW_S + 61, exp: NOW_S + 121 })), EXPECT_FIELD);
  assert.equal(nonces.size, 1);
});

test('malformed tokens fail closed', async () => {
  const { verifier } = makeVerifier();
  for (const token of [undefined, 42, '', 'a.b', 'a.b.c.d', 'not base64!.x.y', 'x'.repeat(5000)]) await rejectsWith(verifier.verify(token, EXPECT_FIELD), 'malformed');
  await rejectsWith(verifier.verify(`${b64u('not json')}.${b64u(claimsFor())}.AAAA`, EXPECT_FIELD), 'malformed');
  await rejectsWith(verifier.verify(signClaims(sorted, claimsFor(), { crit: ['x'] }), EXPECT_FIELD), 'malformed');
});

test('key rotation: old key valid until notAfter, new key valid from notBefore, both accepted in the overlap', async () => {
  const oldKey = makeProductKey('sorted-old', { notBefore: '2026-01-01T00:00:00.000Z', notAfter: '2026-11-10T00:00:00.000Z' });
  const newKey = makeProductKey('sorted-new', { notBefore: '2026-11-01T00:00:00.000Z' });
  const keys = [oldKey.keyConfig, newKey.keyConfig];
  const during = makeVerifier({ keys, now: NOW }).verifier;
  await during.verify(signClaims(oldKey, claimsFor()), EXPECT_FIELD);
  await during.verify(signClaims(newKey, claimsFor()), EXPECT_FIELD);
  const after = makeVerifier({ keys, now: '2026-11-10T00:00:00.000Z' }).verifier;
  await rejectsWith(after.verify(signClaims(oldKey, claimsFor()), EXPECT_FIELD), 'key_inactive');
  const before = makeVerifier({ keys: [newKey.keyConfig], now: '2026-10-31T23:59:59.000Z' }).verifier;
  await rejectsWith(before.verify(signClaims(newKey, claimsFor()), EXPECT_FIELD), 'key_inactive');
});

test('key configuration is validated: private material, wrong curve, duplicates and bad windows are refused', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwkPrivate = privateKey.export({ format: 'jwk' });
  const nonces = memoryNonces();
  const good = sorted.keyConfig;
  assert.throws(() => new LinkAssertionVerifier([{ productId: 'sorted', keys: [{ ...good, jwk: jwkPrivate }] }], nonces), /public Ed25519/);
  assert.throws(() => new LinkAssertionVerifier([{ productId: 'sorted', keys: [{ ...good, jwk: { ...good.jwk, crv: 'P-256' } }] }], nonces), /public Ed25519/);
  assert.throws(() => new LinkAssertionVerifier([{ productId: 'sorted', keys: [good] }, { productId: 'sorted', keys: [good] }], nonces), /duplicate/);
  assert.throws(() => new LinkAssertionVerifier([{ productId: 'sorted', keys: [good, good] }], nonces), /duplicate|kid/);
  assert.throws(() => new LinkAssertionVerifier([{ productId: 'field', keys: [good] }], nonces), /unknown product/);
  assert.throws(() => new LinkAssertionVerifier([{ productId: 'sorted', keys: [{ ...good, notAfter: good.notBefore }] }], nonces), /validity/);
  assert.throws(() => new LinkAssertionVerifier([{ productId: 'sorted', keys: [good] }], {}), /nonce store/);
});
