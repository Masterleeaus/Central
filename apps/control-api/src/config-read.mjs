/** Server-to-server read of resolved feature flags (issue #38, docs/CONFIG.md sections 3 and 4).
 * GET /internal/v1/config/{environment}/{flag_key}
 * The product comes from the verified service token audience. The organisation and cohorts come only
 * from verified token claims (see verifiedContextFromClaims). No query parameter, path segment or body
 * field can choose a tenant, cohort or product. Store failures resolve to the declared default. */
import { FLAG_ENVIRONMENTS, FLAG_PRODUCTS, FlagError, resolveFlag, trustVerifiedContext } from '../../../packages/control-plane/dist/feature-flags.js';

export const CONFIG_READ_PREFIX = '/internal/v1/config/';
export const PRODUCT_AUDIENCE_PREFIX = 'urn:titan-central:product:';
/** Verified access-token claims read by the config endpoint. Missing organisation claim means the global scope. */
export const ORGANISATION_CLAIM = 'titan_organisation_id';
export const COHORT_CLAIM = 'titan_cohorts';

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COHORT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_COHORTS = 32;

const noStore = Object.freeze({ 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
const respond = (res, status, body) => { res.writeHead(status, noStore); res.end(JSON.stringify(body)); };
const bearer = req => { const h = req.headers.authorization; return typeof h === 'string' && /^Bearer [A-Za-z0-9_.-]+$/.test(h) ? h.slice(7) : undefined; };

/** The audience a product's service token must carry, e.g. urn:titan-central:product:sorted. */
export function productAudience(product) {
  if (!FLAG_PRODUCTS.includes(product)) throw new Error('unknown product for config audience');
  return `${PRODUCT_AUDIENCE_PREFIX}${product}`;
}

/**
 * Maps verified claims to the verified context the resolver trusts.
 *   titan_organisation_id  UUID string, or absent/null for the global scope. Stored lower-case.
 *   titan_cohorts          array of cohort names, or absent for none.
 * Throws on any malformed claim. The caller treats that as an unauthenticated token.
 */
export function verifiedContextFromClaims(claims = {}) {
  const org = claims[ORGANISATION_CLAIM];
  let organisationId = null;
  if (org !== undefined && org !== null) {
    if (typeof org !== 'string' || !UUID_RE.test(org)) throw new Error('invalid organisation claim');
    organisationId = org.toLowerCase();
  }
  const cohorts = claims[COHORT_CLAIM] ?? [];
  if (!Array.isArray(cohorts) || cohorts.length > MAX_COHORTS || !cohorts.every(c => typeof c === 'string' && COHORT_RE.test(c))) {
    throw new Error('invalid cohort claim');
  }
  return trustVerifiedContext({ organisationId, cohorts });
}

/**
 * verifiers: Map of product -> async (token) => { logtoSubject, claims }, one per product audience.
 * Returns async (token) => { product, logtoSubject, context }. The first verifier that accepts the
 * token names the product. A token for a non-product audience matches none and is refused.
 */
export function createServiceIdentityVerifier(verifiers) {
  if (!(verifiers instanceof Map) || verifiers.size < 1) throw new Error('at least one product verifier required');
  return async token => {
    let lastError;
    for (const [product, verify] of verifiers) {
      try {
        const verified = await verify(token);
        return { product, logtoSubject: verified.logtoSubject, context: verifiedContextFromClaims(verified.claims) };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error('no product audience matched');
  };
}

/**
 * registry and store come from control-plane (createFlagRegistry, createPostgresFlagStore). They are
 * injected so tests can use fakes. Returns async (req, res). Always answers the request it is given.
 */
export function createConfigReadHandler({ verifyServiceToken, registry, store, storeTimeoutMs, now, logger = () => {} }) {
  if (typeof verifyServiceToken !== 'function' || !registry || !store) throw new Error('config read dependencies required');
  const audit = (event, fields = {}) => { try { logger(event, fields); } catch { /* logging never alters the outcome */ } };
  return async (req, res) => {
    let url;
    try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { return respond(res, 400, { error: 'invalid_url' }); }
    if (req.method !== 'GET') return respond(res, 405, { error: 'method_not_allowed' });
    const token = bearer(req);
    if (!token) return respond(res, 401, { error: 'unauthenticated' });
    let identity;
    try { identity = await verifyServiceToken(token); }
    catch { audit('config_unauthenticated'); return respond(res, 401, { error: 'unauthenticated' }); }
    if (!identity || !FLAG_PRODUCTS.includes(identity.product) || !identity.context) {
      audit('config_unknown_product');
      return respond(res, 403, { error: 'unknown_product' });
    }
    // Any query parameter is refused, so no tenant, cohort or product can arrive from the client.
    if (url.search !== '') { audit('config_rejected', { reason: 'query' }); return respond(res, 400, { error: 'unexpected_parameter' }); }
    const parts = url.pathname.slice(CONFIG_READ_PREFIX.length).split('/');
    if (!url.pathname.startsWith(CONFIG_READ_PREFIX) || parts.length !== 2 || parts.some(p => p === '')) {
      return respond(res, 404, { error: 'not_found' });
    }
    const [environment, key] = parts;
    if (!FLAG_ENVIRONMENTS.includes(environment)) return respond(res, 400, { error: 'invalid_environment' });
    if (!KEY_RE.test(key)) return respond(res, 400, { error: 'invalid_key' });
    try {
      const resolved = await resolveFlag(
        { registry, store, storeTimeoutMs, now },
        { product: identity.product, environment, key },
        identity.context,
      );
      audit('config_read', { product: identity.product, environment, key, source: resolved.source });
      return respond(res, 200, { key, value: resolved.value, source: resolved.source, revision: resolved.revision });
    } catch (e) {
      if (e instanceof FlagError && e.code === 'UNDECLARED_FLAG') return respond(res, 404, { error: 'undeclared_flag' });
      audit('config_read_failed', { error_class: e?.name });
      return respond(res, 503, { error: 'config_unavailable' });
    }
  };
}
