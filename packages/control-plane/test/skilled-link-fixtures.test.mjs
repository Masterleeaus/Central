// Cross-check between Skilled's link-assertion fixtures (LA-01..LA-26, copied verbatim into
// test/fixtures/skilled-link-assertions/) and Central's LinkAssertionVerifier (docs/LINKING.md).
//
// Skilled's signer (lms-main/apps/backend/src/modules/auth/central-link-assertion.ts) makes authority decisions
// before signing. Central cannot see those decisions, so for each fixture this test puts the wire-level claims
// Skilled would produce into a token signed by a fixed test key, and asserts what Central's verifier does with it.
// Central's own truth is the base request below. A fixture that changes only Skilled-side authority yields a token
// Central accepts; that is a product-side trust point, recorded in docs/LINKING.md, not a Central defect.
//
// Also checks the committed canonical file test/fixtures/skilled-link-assertions/canonical-signed.json, which
// carries the public key and one signed token per fixture for Skilled to verify against.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LinkAssertionVerifier, LinkAssertionRejected } from '../dist/link-assertion.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/skilled-link-assertions');
const CANONICAL = path.join(FIXTURES, 'canonical-signed.json');
const KID = 'skilled-key-2026';
const NOW_ISO = '2026-11-09T02:00:00.000Z';
const NOW_S = Math.floor(Date.parse(NOW_ISO) / 1000);
const BASE = {
  logtoSubject: 'central-user-0001', logtoOrganisationId: 'central-org-0001',
  localUserId: 'skilled-user-0001', localAccountId: 'skilled-account-0001',
};
const DEFAULT_NONCE = 'a'.repeat(32);

// Deterministic test-only Ed25519 keys. Seeds are hashes of fixed labels; they are not secrets.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const keyFromLabel = (label) => {
  const seed = createHash('sha256').update(label).digest();
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
};
const privateKey = keyFromLabel('titan-central skilled link fixtures v1');
const wrongKey = keyFromLabel('titan-central skilled link fixtures wrong key');
const publicJwk = { kty: 'OKP', crv: 'Ed25519', x: createPublicKey(privateKey).export({ format: 'jwk' }).x };

const b64u = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Builds the wire token Skilled's signer would produce for one fixture's changes. companyId and Skilled-side
 * authority flags are not on the wire. Request fields map to the claims: logtoSubject to sub, and so on. */
function wireToken(changes = {}, { key = privateKey, kid = changes.kid ?? KID } = {}) {
  const request = { ...BASE, ...(changes.request ?? {}) };
  const ttl = changes.ttlSeconds ?? 120;
  const header = { alg: 'EdDSA', typ: 'titan-link+jwt', kid };
  const claims = {
    iss: 'lms', aud: 'titan-central',
    sub: request.logtoSubject, org: request.logtoOrganisationId,
    lu: request.localUserId, la: request.localAccountId,
    nonce: changes.nonce ?? DEFAULT_NONCE, iat: NOW_S, exp: NOW_S + ttl,
  };
  const signingInput = `${b64u(header)}.${b64u(claims)}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput, 'ascii'), changes.invalidKey ? wrongKey : key).toString('base64url')}`;
}

/** Central's expectation: the command's own identity, organisation and account. */
const EXPECTED = { applicationId: 'academy', ...BASE };

/** Expected Central outcome per fixture. 'accept' means a well-formed, correctly signed assertion that only
 * Skilled-side authority would have refused. Any other value is the code Central's verifier must throw. */
const OUTCOME = {
  'valid-default': 'accept', 'valid-short-ttl': 'accept', 'valid-max-ttl': 'accept', 'valid-custom-nonce': 'accept',
  'missing-subject': 'identifier_not_permitted', 'short-subject': 'identifier_not_permitted', 'email-subject': 'identifier_not_permitted',
  'missing-organisation': 'identifier_not_permitted',
  'wrong-local-account': 'accept', 'company-not-authorised': 'accept', 'member-revoked': 'accept',
  'invalid-company': 'accept', 'cross-company': 'accept',
  'wrong-user': 'account_mismatch', 'missing-account': 'identifier_not_permitted',
  'invalid-kid': 'malformed', 'zero-ttl': 'bad_lifetime', 'excessive-ttl': 'bad_lifetime', 'fractional-ttl': 'bad_lifetime',
  'invalid-nonce': 'malformed', 'invalid-key': 'bad_signature',
  'expired-account': 'accept', 'suspended-organisation': 'accept', 'deleted-local-user': 'accept',
  'unverified-local-user': 'accept', 'unknown-local-user': 'accept',
};

const memoryNonces = () => {
  const seen = new Map();
  return {
    async consume(product, nonce, expiresAt, now) {
      for (const [k, exp] of seen) if (exp <= Date.parse(now)) seen.delete(k);
      const k = `${product}|${nonce}`;
      if (seen.has(k)) return false;
      seen.set(k, Date.parse(expiresAt));
      return true;
    },
  };
};
const verifierFor = () => new LinkAssertionVerifier(
  [{ productId: 'lms', keys: [{ kid: KID, jwk: publicJwk, notBefore: '2026-01-01T00:00:00.000Z' }] }],
  memoryNonces(), () => NOW_ISO,
);

const fixtureFiles = readdirSync(FIXTURES).filter(n => /^LA-\d{2}-.*\.json$/.test(n)).sort();
const fixtures = fixtureFiles.map(file => JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8')));

test('every Skilled fixture has an explicit Central outcome', () => {
  assert.equal(fixtures.length, 26);
  assert.deepEqual(fixtures.map(f => f.name).sort(), Object.keys(OUTCOME).sort());
});

for (const fixture of fixtures) {
  test(`Skilled ${fixture.name}: Central outcome ${OUTCOME[fixture.name]}`, async () => {
    const token = wireToken(fixture.changes);
    const verifier = verifierFor();
    const expected = OUTCOME[fixture.name];
    if (expected === 'accept') {
      const result = await verifier.verify(token, EXPECTED);
      assert.equal(result.productId, 'lms');
      assert.equal(result.expiresAt, new Date((NOW_S + (fixture.changes.ttlSeconds ?? 120)) * 1000).toISOString());
      return;
    }
    await assert.rejects(verifier.verify(token, EXPECTED),
      (e) => e instanceof LinkAssertionRejected && e.code === expected, `expected ${expected}`);
  });
}

test('a Skilled-side refusal the wire cannot show is not a Central acceptance rule: Skilled denies these before signing', () => {
  // Fixtures with expectedAllowed false whose outcome is 'accept' are refused by Skilled's authority callbacks
  // (or by its local input checks for companyId) before any token exists. Central never receives them.
  const productOnly = fixtures.filter(f => !f.expectedAllowed && OUTCOME[f.name] === 'accept').map(f => f.name);
  assert.deepEqual(productOnly.sort(), ['cross-company', 'company-not-authorised', 'deleted-local-user', 'expired-account',
    'invalid-company', 'member-revoked', 'suspended-organisation', 'unknown-local-user', 'unverified-local-user', 'wrong-local-account'].sort());
});

test('canonical signed file matches the generator and verifies with Central', async () => {
  if (process.env.WRITE_CANONICAL === '1') writeFileSync(CANONICAL, JSON.stringify(buildCanonical(), null, 2) + '\n');
  const canonical = JSON.parse(readFileSync(CANONICAL, 'utf8'));
  assert.deepEqual(canonical, buildCanonical());
  for (const c of canonical.cases) {
    const verifier = verifierFor(); // fresh nonce store per case: every fixture reuses the default nonce
    if (c.expected === 'accept') await verifier.verify(c.token, EXPECTED);
    else await assert.rejects(verifier.verify(c.token, EXPECTED), (e) => e instanceof LinkAssertionRejected && e.code === c.expected, c.name);
  }
});

/** Canonical set for Skilled: public key, clock, and one signed token per fixture with the expected Central result. */
export function buildCanonical() {
  return {
    productId: 'lms',
    kid: KID,
    jwk: publicJwk,
    notBefore: '2026-01-01T00:00:00.000Z',
    now: NOW_ISO,
    expectation: EXPECTED,
    cases: fixtures.map(f => ({ name: f.name, token: wireToken(f.changes), expected: OUTCOME[f.name] })),
  };
}
