import { readFileSync } from 'node:fs';

/** Product id -> legacy application id used by the Central access check (packages/control-plane LEGACY_TO_PRODUCT, issue #29). */
export const PRODUCT_TO_LEGACY = Object.freeze({ sorted: 'field', supercharged: 'desk', lms: 'academy' });
/** Applications with an existing /auth/titan/{app}/start route in control-api (packages/control-plane applications.ts). */
export const SIGN_IN_APPLICATIONS = Object.freeze(['field', 'desk', 'academy']);

export class ConfigError extends Error {
  constructor(problems) {
    super(`invalid launcher config: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const isLocalHost = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1';

/** https everywhere, plain http only for a local development host, no embedded credentials. */
function safeUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLocalHost(url.hostname)) return url;
  return null;
}

function safeOrigin(value) {
  const url = safeUrl(value);
  if (!url || url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

/**
 * Validates the launcher configuration and returns a frozen copy. Every problem is collected
 * so an operator can fix them in one pass. Fails closed: the launcher does not start on a bad config.
 */
export function loadConfig(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(['config must be an object']);

  const centralOrigin = safeOrigin(raw.centralOrigin);
  if (!centralOrigin) problems.push('centralOrigin must be an https origin (no path, query or credentials)');

  const applicationId = raw.signIn?.applicationId ?? null;
  if (applicationId !== null && !SIGN_IN_APPLICATIONS.includes(applicationId)) {
    problems.push(`signIn.applicationId must be null or one of ${SIGN_IN_APPLICATIONS.join(', ')}`);
  }

  let organisationSwitch = null;
  if (raw.organisationSwitch !== null && raw.organisationSwitch !== undefined) {
    const url = safeUrl(raw.organisationSwitch?.url);
    if (!url) problems.push('organisationSwitch.url must be an https URL when organisationSwitch is set');
    else organisationSwitch = Object.freeze({ url: url.href });
  }

  const timeoutMs = raw.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) problems.push('timeoutMs must be an integer from 100 to 30000');

  const products = [];
  if (!Array.isArray(raw.products)) {
    problems.push('products must be an array');
  } else {
    const seen = new Set();
    for (const entry of raw.products) {
      const id = entry?.id;
      if (!Object.hasOwn(PRODUCT_TO_LEGACY, id)) { problems.push(`unknown product id ${JSON.stringify(id)}`); continue; }
      if (seen.has(id)) { problems.push(`duplicate product ${id}`); continue; }
      seen.add(id);
      if (entry.legacyApplication !== PRODUCT_TO_LEGACY[id]) problems.push(`${id}.legacyApplication must be ${PRODUCT_TO_LEGACY[id]}`);
      if (typeof entry.displayName !== 'string' || entry.displayName.trim().length === 0 || entry.displayName.length > 60) problems.push(`${id}.displayName must be 1-60 characters`);
      const url = safeUrl(entry.url);
      if (!url) problems.push(`${id}.url must be an https URL`);
      products.push(Object.freeze({ id, legacyApplication: PRODUCT_TO_LEGACY[id], displayName: entry.displayName, url: url?.href ?? null }));
    }
    for (const id of Object.keys(PRODUCT_TO_LEGACY)) if (!seen.has(id)) problems.push(`missing product ${id}`);
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return Object.freeze({
    centralOrigin,
    signIn: Object.freeze({ applicationId }),
    organisationSwitch,
    timeoutMs,
    products: Object.freeze(products),
  });
}

/** Reads and validates a JSON config file. Only the path is read; nothing is fetched from the network. */
export function loadConfigFile(path) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (error) { throw new ConfigError([`cannot read ${path}: ${error.message}`]); }
  return loadConfig(raw);
}
