/** Test-only reference signer for the link assertion contract (docs/LINKING.md). Products sign with their own
 * private keys; Central never holds them. Nothing here is imported by src/. */
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export const NOW = '2026-11-09T12:00:00.000Z';
export const NOW_S = Math.floor(Date.parse(NOW) / 1000);
export const ORG_A_LOGTO = 'org_tenanta01';
export const ORG_B_LOGTO = 'org_tenantb01';
export const SUBJECT = 'usr_abcdef12';
export const LOCAL_USER = 'user-0001-abcd';
export const LOCAL_ACCOUNT = 'acct-0001-abcd';

export const b64u = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** A product key pair. keyConfig is what the operator places in Central's configuration (public part only). */
export function makeProductKey(kid, { notBefore = '2026-01-01T00:00:00.000Z', notAfter } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  const keyConfig = { kid, jwk: { kty: 'OKP', crv: 'Ed25519', x }, notBefore, ...(notAfter ? { notAfter } : {}) };
  return { kid, privateKey, keyConfig };
}

export const freshNonce = () => randomBytes(18).toString('base64url');

export function claimsFor(overrides = {}) {
  return {
    iss: 'sorted', aud: 'titan-central', sub: SUBJECT, org: ORG_A_LOGTO,
    lu: LOCAL_USER, la: LOCAL_ACCOUNT, nonce: freshNonce(),
    iat: NOW_S, exp: NOW_S + 120, ...overrides,
  };
}

/** Signs an exact claims object. Pass undefined in overrides to drop a claim. */
export function signClaims(key, claims, header = {}) {
  const headerPart = b64u({ alg: 'EdDSA', typ: 'titan-link+jwt', kid: key.kid, ...header });
  const payloadPart = b64u(claims);
  const sig = sign(null, Buffer.from(`${headerPart}.${payloadPart}`, 'ascii'), key.privateKey).toString('base64url');
  return `${headerPart}.${payloadPart}.${sig}`;
}

export function memoryNonces() {
  const seen = new Map();
  return {
    async consume(product, nonce, expiresAt, now) {
      for (const [k, exp] of seen) if (exp <= Date.parse(now)) seen.delete(k);
      const k = `${product}|${nonce}`;
      if (seen.has(k)) return false;
      seen.set(k, Date.parse(expiresAt));
      return true;
    },
    get size() { return seen.size; },
  };
}

export const EXPECT_FIELD = { applicationId: 'field', logtoSubject: SUBJECT, logtoOrganisationId: ORG_A_LOGTO, localUserId: LOCAL_USER, localAccountId: LOCAL_ACCOUNT };
