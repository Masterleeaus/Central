/** Front Desk WordPress pairing route, contract tzfd-pair/1 (Front Desk PR #427, issue #347; Central issue #189).
 *
 * POST /api/tzfd/pair
 *   Request headers: X-TZFD-Contract: tzfd-pair/1, X-TZFD-Site: site-<24 hex>, X-TZFD-Timestamp (unix seconds),
 *                    X-TZFD-Nonce (32 lowercase hex).
 *   Request body (max 1024 bytes): {"contract":"tzfd-pair/1","site":"<site id>","pairing_code":"<code>"}
 *   200 body: {"contract":"tzfd-pair/1","site":"<site id>","status":"paired","secret":"<64 hex>","feature_endpoint":"https://..."}
 *   The 200 echoes X-TZFD-Nonce and sends a current X-TZFD-Timestamp.
 *   403 {"status":"code_rejected"}: the code is unknown, already used or expired. The plugin maps any 4xx to code_rejected.
 *   503 {"status":"service_error"}: a rate limit or a storage failure. The plugin maps 5xx to service_error.
 *
 * Rules:
 *  - Off unless a store and a feature endpoint are configured. No store means no route (404), so the
 *    server never answers pairing requests it cannot honour.
 *  - A pairing code is single use. Only its SHA-256 digest is passed to the store, so the code itself is never stored.
 *  - The secret is returned once. The store receives it only to keep the site credential for later requests.
 *  - A new pairing rotates the site secret. A failed exchange changes nothing.
 *  - The feature endpoint is https and its host must be on the allowlist (default: superchargedat.work).
 *  - Nothing in the logs contains the code, the secret or the request body.
 *
 * Store contract (injected; a Postgres store is a follow-up):
 *   consumePairingCode(codeDigestHex, nowMs) -> Promise<{ companyUuid: string } | null>   // atomic: marks the code used
 *   rotateSiteSecret({ siteId, secret, companyUuid, nowMs }) -> Promise<void>              // throws on failure
 */
import { createHash, randomBytes } from 'node:crypto';
import { createRateLimiter } from './rate-limit.mjs';

export const TZFD_PAIR_PATH = '/api/tzfd/pair';
export const TZFD_PAIR_CONTRACT = 'tzfd-pair/1';
export const TZFD_DEFAULT_FEATURE_HOSTS = Object.freeze(['superchargedat.work']);
const SITE = /^site-[a-f0-9]{24}$/;
const NONCE = /^[0-9a-f]{32}$/;
const CODE = /^[A-Za-z0-9_-]{16,64}$/;
const TIMESTAMP = /^[0-9]{1,11}$/;
const SIGNATURE_WINDOW_SECONDS = 300;
const MAX_BODY_BYTES = 1024;
const RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60_000 });

const sha256Hex = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Digest used as the store key. The plain code is never passed to the store. */
export function pairingCodeDigest(code) {
  return sha256Hex(code);
}

/** Mints a new single-use code for the admin screen. Returns the code once and its digest for storage. */
export function mintPairingCode() {
  const code = randomBytes(18).toString('base64url'); // 24 characters from [A-Za-z0-9_-]
  return { code, digest: pairingCodeDigest(code) };
}

function feature(endpoint, allowedHosts) {
  let url;
  try { url = new URL(endpoint); } catch { throw new TypeError('invalid feature endpoint'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw new TypeError('invalid feature endpoint');
  if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new TypeError('feature endpoint host not allowed');
  return url.toString();
}

const respond = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Returns an async (req, res) => boolean handler. It returns false for any path other than TZFD_PAIR_PATH,
 * so other routes are unaffected.
 */
export function createTzfdPairingHandler({
  store,
  featureEndpoint,
  allowedFeatureHosts = TZFD_DEFAULT_FEATURE_HOSTS,
  clientIp = (req) => req.socket?.remoteAddress ?? 'unknown',
  rateLimiter = createRateLimiter(RATE_LIMIT),
  logger = () => {},
  clock = () => Date.now(),
  secretFactory = () => randomBytes(32).toString('hex'),
} = {}) {
  if (!store || typeof store.consumePairingCode !== 'function' || typeof store.rotateSiteSecret !== 'function') {
    throw new TypeError('pairing store required');
  }
  if (typeof featureEndpoint !== 'string') throw new TypeError('feature endpoint required');
  const hosts = allowedFeatureHosts.map((h) => String(h).toLowerCase());
  const endpoint = feature(featureEndpoint, hosts);
  const audit = (event, fields = {}) => { try { logger(event, fields); } catch { /* logging never changes the outcome */ } };

  return async (req, res) => {
    const path = req.url?.split('?')[0];
    if (path !== TZFD_PAIR_PATH) return false;
    if (req.url !== TZFD_PAIR_PATH) { respond(res, 400, { status: 'invalid_request' }); return true; }
    if (req.method !== 'POST') { respond(res, 405, { status: 'method_not_allowed' }); return true; }

    const limit = rateLimiter.take(clientIp(req));
    if (!limit.allowed) {
      audit('tzfd_pair_rate_limited');
      respond(res, 503, { status: 'service_error' }, { 'retry-after': String(limit.retryAfterSeconds) });
      return true;
    }

    const nowMs = clock();
    const nowSec = Math.floor(nowMs / 1000);
    const h = req.headers;
    const site = typeof h['x-tzfd-site'] === 'string' ? h['x-tzfd-site'] : '';
    const nonce = typeof h['x-tzfd-nonce'] === 'string' ? h['x-tzfd-nonce'] : '';
    const ts = typeof h['x-tzfd-timestamp'] === 'string' ? h['x-tzfd-timestamp'] : '';
    if (h['x-tzfd-contract'] !== TZFD_PAIR_CONTRACT || !SITE.test(site) || !NONCE.test(nonce) || !TIMESTAMP.test(ts)
      || Math.abs(nowSec - Number(ts)) > SIGNATURE_WINDOW_SECONDS) {
      respond(res, 400, { status: 'invalid_request' });
      return true;
    }

    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { respond(res, 400, { status: 'invalid_request' }); return true; }
    if (!body || typeof body !== 'object' || body.contract !== TZFD_PAIR_CONTRACT || body.site !== site
      || typeof body.pairing_code !== 'string' || !CODE.test(body.pairing_code)) {
      respond(res, 400, { status: 'invalid_request' });
      return true;
    }

    try {
      const grant = await store.consumePairingCode(pairingCodeDigest(body.pairing_code), nowMs);
      if (!grant || typeof grant.companyUuid !== 'string' || grant.companyUuid === '') {
        audit('tzfd_pair_code_rejected');
        respond(res, 403, { status: 'code_rejected' });
        return true;
      }
      const secret = secretFactory();
      await store.rotateSiteSecret({ siteId: site, secret, companyUuid: grant.companyUuid, nowMs });
      audit('tzfd_pair_ok');
      respond(res, 200, {
        contract: TZFD_PAIR_CONTRACT,
        site,
        status: 'paired',
        secret,
        feature_endpoint: endpoint,
      }, { 'x-tzfd-nonce': nonce, 'x-tzfd-timestamp': String(nowSec) });
    } catch {
      audit('tzfd_pair_failed');
      respond(res, 503, { status: 'service_error' });
    }
    return true;
  };
}

/** Reads the route settings from the environment. Returns null (route off) unless TZFD_PAIR_FEATURE_ENDPOINT is set. */
export function readTzfdPairingConfig(env) {
  const endpoint = env.TZFD_PAIR_FEATURE_ENDPOINT;
  if (endpoint === undefined || endpoint === '') return null;
  const hosts = env.TZFD_PAIR_FEATURE_HOSTS
    ? env.TZFD_PAIR_FEATURE_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : [...TZFD_DEFAULT_FEATURE_HOSTS];
  feature(endpoint, hosts.map((h) => h.toLowerCase())); // throws on a bad endpoint or host
  return { featureEndpoint: endpoint, allowedFeatureHosts: hosts };
}
