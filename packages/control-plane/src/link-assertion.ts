/**
 * Link assertion verifier (issue #37). Contract: docs/LINKING.md.
 *
 * A destination product signs a short-lived compact JWS (alg EdDSA, Ed25519 keys) that proves control
 * of one local user and local account for one Central identity, organisation and application.
 * Central verifies it against operator-configured public keys for that product only.
 *
 * Email addresses and display names are never identifiers: they are rejected as claims and as values.
 * Pure module: no network, no environment reads. The nonce store is injected (PostgreSQL in production).
 */
import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import type { ApplicationId } from './contracts.js';
import { LEGACY_TO_PRODUCT, PRODUCT_IDS, type ProductId } from './product-registry.js';
import type { SqlPool } from './postgres.js';
import type { VerifyLocalLink } from './trusted-provisioning.js';

export const LINK_ASSERTION_AUDIENCE = 'titan-central';
export const LINK_ASSERTION_TYPE = 'titan-link+jwt';
/** Maximum exp minus iat. Nonces need only be remembered until exp, so this bounds the replay window. */
export const LINK_ASSERTION_MAX_LIFETIME_SECONDS = 300;
/** Tolerated clock difference for iat (future-dated) only. exp is never extended by skew. */
export const LINK_ASSERTION_CLOCK_SKEW_SECONDS = 30;
export const LINK_ASSERTION_MAX_KEYS_PER_PRODUCT = 8;
const MAX_TOKEN_LENGTH = 4096;
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
/** Opaque identifier: starts alphanumeric, no '@' (email), no whitespace (display names). */
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const HEADER_FIELDS = ['alg', 'typ', 'kid'];
const REQUIRED_CLAIMS = ['iss', 'aud', 'sub', 'org', 'lu', 'la', 'nonce', 'iat', 'exp'];
/** Any of these in the claims is a rejection, even alongside valid identifiers. */
const FORBIDDEN_CLAIMS = ['email', 'email_verified', 'name', 'given_name', 'family_name', 'display_name', 'displayName', 'preferred_username', 'username', 'nickname', 'phone_number'];

export interface LinkPublicJwk { kty: 'OKP'; crv: 'Ed25519'; x: string; }
export interface LinkKeyConfig {
  /** Key ID carried in the JWS header. Unique within its product. */
  kid: string;
  jwk: LinkPublicJwk;
  /** Key accepted from this instant (ISO 8601). Rotation: publish the new key before products switch to it. */
  notBefore: string;
  /** Key rejected from this instant (ISO 8601). Omit while the key is current. */
  notAfter?: string;
}
/** One key set per product. Keys are operator-controlled configuration, never read from a request. */
export interface ProductLinkKeySet { productId: ProductId; keys: readonly LinkKeyConfig[]; }

/** Atomic check-and-record. Returns true only when the nonce was unused; it is then kept until expiresAt. */
export interface LinkNonceStore {
  consume(productId: ProductId, nonce: string, expiresAt: string, now: string): Promise<boolean>;
}

export interface LinkAssertionExpectation {
  /** Legacy application id of the account being linked. Must map to the asserting product. */
  applicationId: ApplicationId;
  /** Central identity subject (Logto subject) resolved by Central from identities.id. */
  logtoSubject: string;
  /** Logto organisation ID resolved by Central from organisations.id. */
  logtoOrganisationId: string;
  localUserId: string;
  localAccountId: string;
}

export interface LinkAssertionResult { productId: ProductId; nonce: string; issuedAt: string; expiresAt: string; }

export type LinkRejectionCode =
  | 'malformed' | 'bad_algorithm' | 'unknown_product' | 'product_mismatch' | 'wrong_audience'
  | 'unknown_key' | 'key_inactive' | 'bad_signature' | 'forbidden_claim' | 'missing_claim'
  | 'identifier_not_permitted' | 'bad_lifetime' | 'future_dated' | 'expired' | 'replayed'
  | 'subject_mismatch' | 'organisation_mismatch' | 'account_mismatch';

export class LinkAssertionRejected extends Error {
  constructor(readonly code: LinkRejectionCode) { super(`link assertion rejected: ${code}`); this.name = 'LinkAssertionRejected'; }
}

interface ActiveKey { key: KeyObject; notBefore: number; notAfter?: number; }

function indexKeySets(sets: readonly ProductLinkKeySet[]): Map<ProductId, Map<string, ActiveKey>> {
  if (!Array.isArray(sets)) throw new TypeError('link key sets required');
  const out = new Map<ProductId, Map<string, ActiveKey>>();
  for (const set of sets) {
    if (!(PRODUCT_IDS as readonly string[]).includes(set?.productId)) throw new TypeError('unknown product in link key set');
    if (out.has(set.productId)) throw new TypeError('duplicate link key set for product');
    if (!Array.isArray(set.keys) || set.keys.length < 1 || set.keys.length > LINK_ASSERTION_MAX_KEYS_PER_PRODUCT) throw new TypeError('invalid link key count');
    const byKid = new Map<string, ActiveKey>();
    for (const k of set.keys) {
      if (typeof k?.kid !== 'string' || !KID.test(k.kid) || byKid.has(k.kid)) throw new TypeError('invalid or duplicate link key id');
      const jwk = k.jwk as Partial<LinkPublicJwk> & Record<string, unknown>;
      if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || !B64URL.test(jwk.x) || Buffer.from(jwk.x, 'base64url').length !== 32 || Object.keys(jwk).some(f => !['kty', 'crv', 'x'].includes(f)))
        throw new TypeError('link key must be a public Ed25519 OKP JWK');
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
      const notBefore = Date.parse(k.notBefore);
      const notAfter = k.notAfter === undefined ? undefined : Date.parse(k.notAfter);
      if (!Number.isFinite(notBefore) || (notAfter !== undefined && (!Number.isFinite(notAfter) || notAfter <= notBefore))) throw new TypeError('invalid link key validity window');
      byKid.set(k.kid, { key, notBefore, notAfter });
    }
    out.set(set.productId, byKid);
  }
  return out;
}

const decodeJsonObject = (segment: string): Record<string, unknown> => {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')); } catch { throw new LinkAssertionRejected('malformed'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LinkAssertionRejected('malformed');
  return value as Record<string, unknown>;
};
function fail(code: LinkRejectionCode): never { throw new LinkAssertionRejected(code); }

export class LinkAssertionVerifier {
  private readonly keys: Map<ProductId, Map<string, ActiveKey>>;
  constructor(keySets: readonly ProductLinkKeySet[], private readonly nonces: LinkNonceStore, private readonly clock: () => string = () => new Date().toISOString()) {
    this.keys = indexKeySets(keySets);
    if (typeof nonces?.consume !== 'function') throw new TypeError('link nonce store required');
  }

  /** Throws LinkAssertionRejected with a fixed code. Nonce is consumed only after every other check passes. */
  async verify(token: unknown, expected: LinkAssertionExpectation): Promise<LinkAssertionResult> {
    const now = this.clock();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new TypeError('invalid verifier clock');
    const expectedProduct = LEGACY_TO_PRODUCT[expected.applicationId];
    if (!expectedProduct) fail('unknown_product');
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) fail('malformed');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(p => B64URL.test(p))) fail('malformed');
    const [headerB64, claimsB64, sigB64] = parts as [string, string, string];

    const header = decodeJsonObject(headerB64);
    if (header.alg !== 'EdDSA' || header.typ !== LINK_ASSERTION_TYPE) fail('bad_algorithm');
    if (Object.keys(header).some(f => !HEADER_FIELDS.includes(f)) || typeof header.kid !== 'string' || !KID.test(header.kid)) fail('malformed');

    const claims = decodeJsonObject(claimsB64);
    if (FORBIDDEN_CLAIMS.some(name => Object.hasOwn(claims, name))) fail('forbidden_claim');
    if (typeof claims.iss !== 'string') fail('missing_claim');
    if (!(PRODUCT_IDS as readonly string[]).includes(claims.iss)) fail('unknown_product');
    const productId = claims.iss as ProductId;
    const productKeys = this.keys.get(productId);
    if (!productKeys) fail('unknown_product');
    if (productId !== expectedProduct) fail('product_mismatch');
    if (claims.aud !== LINK_ASSERTION_AUDIENCE) fail('wrong_audience');

    const key = productKeys.get(header.kid as string);
    if (!key) fail('unknown_key');
    if (nowMs < key.notBefore || (key.notAfter !== undefined && nowMs >= key.notAfter)) fail('key_inactive');
    const signature = Buffer.from(sigB64, 'base64url');
    if (signature.length !== 64 || !verifySignature(null, Buffer.from(`${headerB64}.${claimsB64}`, 'ascii'), key.key, signature)) fail('bad_signature');

    // Only now are the claims trusted to be what the product signed.
    if (REQUIRED_CLAIMS.some(name => !Object.hasOwn(claims, name))) fail('missing_claim');
    const { iat, exp } = claims;
    if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) || (exp as number) <= (iat as number) || (exp as number) - (iat as number) > LINK_ASSERTION_MAX_LIFETIME_SECONDS) fail('bad_lifetime');
    if ((iat as number) * 1000 > nowMs + LINK_ASSERTION_CLOCK_SKEW_SECONDS * 1000) fail('future_dated');
    if (nowMs >= (exp as number) * 1000) fail('expired');
    for (const field of ['sub', 'org', 'lu', 'la'] as const) if (typeof claims[field] !== 'string' || !OPAQUE_ID.test(claims[field] as string)) fail('identifier_not_permitted');
    if (typeof claims.nonce !== 'string' || !NONCE.test(claims.nonce)) fail('malformed');

    if (claims.sub !== expected.logtoSubject) fail('subject_mismatch');
    if (claims.org !== expected.logtoOrganisationId) fail('organisation_mismatch');
    if (claims.lu !== expected.localUserId || claims.la !== expected.localAccountId) fail('account_mismatch');

    const expiresAt = new Date((exp as number) * 1000).toISOString();
    if (!(await this.nonces.consume(productId, claims.nonce, expiresAt, now))) fail('replayed');
    return { productId, nonce: claims.nonce, issuedAt: new Date((iat as number) * 1000).toISOString(), expiresAt };
  }
}

/** Nonce store on PostgreSQL. Runs as titan_trusted_writer (migration 0014). Expired rows are pruned in the same
 * transaction, which bounds the table to the replay window: an assertion past expiry is rejected anyway. */
export function createPostgresLinkNonceStore(pool: SqlPool): LinkNonceStore {
  return {
    async consume(productId, nonce, expiresAt, now) {
      const conn = await pool.connect(); let begun = false;
      try {
        await conn.query('BEGIN'); begun = true;
        await conn.query('SET LOCAL ROLE titan_trusted_writer');
        await conn.query("SET LOCAL statement_timeout = '5000ms'");
        await conn.query('DELETE FROM titan.link_assertion_nonces WHERE expires_at <= $1', [now]);
        const result = await conn.query('INSERT INTO titan.link_assertion_nonces (product_id, nonce, expires_at) VALUES ($1, $2, $3) ON CONFLICT (product_id, nonce) DO NOTHING RETURNING nonce', [productId, nonce, expiresAt]);
        await conn.query('COMMIT'); begun = false;
        return (result.rowCount ?? result.rows.length) === 1;
      } catch (error) {
        if (begun) { try { await conn.query('ROLLBACK'); } catch { /* original error remains authoritative */ } }
        throw error;
      } finally { conn.release?.(); }
    }
  };
}

/** The hook TrustedProvisioningService calls for link and link_relink. Subject and organisation come from Central's
 * own identity and organisation records, never from the command. Any rejection throws; it never returns false. */
export function verifyLinkCommand(verifier: LinkAssertionVerifier): VerifyLocalLink {
  return async ({ command, logtoSubject, logtoOrganisationId }) => {
    await verifier.verify(command.assertion, {
      applicationId: command.applicationId,
      logtoSubject,
      logtoOrganisationId,
      localUserId: command.localUserId,
      localAccountId: command.localAccountId,
    });
    return true;
  };
}
