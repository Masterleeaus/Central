import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { insecureLocalhostAllowed, isSecureEndpoint } from './endpoint-policy.mjs';
import { createJwksRefreshGuard } from './jwks-refresh-guard.mjs';

export class OidcVerificationError extends Error { constructor(message) { super(message); this.name='OidcVerificationError'; } }
const b64json = (part) => { try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { throw new OidcVerificationError('malformed JWT'); } };
const validString = (v) => typeof v === 'string' && v.length > 0;
/** Strict RS256 JWT resource-server verification with fixed issuer, audience and configured JWKS endpoint.
 * Tokens and JWKS URLs are NEVER taken from a request. No unverified claims are trusted.
 * Unknown kids trigger at most one forced JWKS refresh per refreshCooldownMs (per instance). */
export function createOidcVerifier({ issuer, audience, jwksUri, fetcher=fetch, clock=()=>Date.now(), cacheMs=60_000,
  allowInsecureLocalhost=insecureLocalhostAllowed(), refreshCooldownMs=30_000, claimNames=[] }) {
  if (!validString(issuer) || !validString(audience) || !validString(jwksUri)) throw new Error('OIDC configuration required');
  if (!Array.isArray(claimNames) || claimNames.length > 16 || !claimNames.every(n => validString(n))) throw new Error('claimNames must be a list of claim names');
  if (!isSecureEndpoint(issuer, allowInsecureLocalhost)) throw new Error('secure OIDC issuer required');
  if (!isSecureEndpoint(jwksUri, allowInsecureLocalhost)) throw new Error('secure JWKS URI required');
  const guard = createJwksRefreshGuard({ cooldownMs: refreshCooldownMs, clock });
  let cache, until=0;
  async function loadKeys(refresh=false) {
    if (!refresh && cache && clock() < until) return cache;
    guard.recordFetch();
    const response = await fetcher(jwksUri, { headers: { accept:'application/json' }, signal: AbortSignal.timeout(4000), redirect:'error' });
    if (!response.ok) throw new OidcVerificationError('JWKS unavailable');
    const parsed = await response.json();
    if (!Array.isArray(parsed.keys) || parsed.keys.length > 64) throw new OidcVerificationError('invalid JWKS');
    cache=parsed.keys.filter(k => k.kty==='RSA' && k.use !== 'enc' && (!k.alg || k.alg === 'RS256') && validString(k.kid));
    until=clock()+Math.min(Math.max(cacheMs, 0), 300_000);
    return cache;
  }
  return async function verifyToken(token) {
    if (!validString(token) || token.length > 16_384) throw new OidcVerificationError('invalid bearer token');
    const segments=token.split('.');
    if (segments.length!==3) throw new OidcVerificationError('malformed JWT');
    const [h,p,s]=segments; const header=b64json(h), payload=b64json(p);
    if (header.alg!=='RS256' || !validString(header.kid) || header.crit || header.jku || header.x5u) throw new OidcVerificationError('unsupported JWT header');
    let keys=await loadKeys();
    let key=keys.find(k=>k.kid===header.kid);
    if (!key && guard.mayRefresh(header.kid)) {keys=await loadKeys(true);key=keys.find(k=>k.kid===header.kid);}
    if (!key) {guard.recordMiss(header.kid);throw new OidcVerificationError('unrecognised key');}
    let publicKey; try {publicKey=createPublicKey({key,format:'jwk'});} catch {throw new OidcVerificationError('invalid signing key');}
    let signature; try {signature=Buffer.from(s,'base64url');} catch {throw new OidcVerificationError('invalid signature');}
    if (!cryptoVerify('RSA-SHA256',Buffer.from(`${h}.${p}`),publicKey,signature)) throw new OidcVerificationError('invalid signature');
    const seconds=Math.floor(clock()/1000);
    if (payload.iss!==issuer || !(payload.aud===audience || (Array.isArray(payload.aud)&&payload.aud.includes(audience)))) throw new OidcVerificationError('issuer or audience mismatch');
    if (!validString(payload.sub) || !Number.isSafeInteger(payload.exp) || payload.exp<=seconds || payload.iat && (!Number.isSafeInteger(payload.iat) || payload.iat>seconds+60) || payload.nbf && (!Number.isSafeInteger(payload.nbf) || payload.nbf>seconds+60)) throw new OidcVerificationError('expired or invalid token');
    // Only the claims named in claimNames are returned, and only after the signature, issuer, audience and expiry checks above.
    const claims = {};
    for (const name of claimNames) if (payload[name] !== undefined) claims[name] = payload[name];
    return { logtoSubject: payload.sub, issuer, audience, verifiedAt: new Date(clock()).toISOString(), claims };
  };
}
