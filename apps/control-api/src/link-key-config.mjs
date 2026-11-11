/** Link assertion public keys (issue #37). Operator configuration, read once at startup, never from a request.
 * Exactly one source may be set. Names only; values never appear in an error message:
 *   TITAN_LINK_KEYS_FILE   path to a JSON file holding the key sets
 *   TITAN_LINK_KEYS_JSON   the same JSON, inline
 * Shape: [ { "productId": "sorted", "keys": [ { "kid": "...", "alg": "EdDSA",
 *            "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
 *            "notBefore": "2026-01-01T00:00:00.000Z", "notAfter": "2026-12-31T00:00:00.000Z" } ] } ]
 * Any malformed key throws at startup. Unset means no key sets: link provisioning stays disabled.
 */
import { readFileSync } from 'node:fs';
import { LINK_ASSERTION_MAX_KEYS_PER_PRODUCT, LinkAssertionVerifier, PRODUCT_IDS } from '../../../packages/control-plane/dist/index.js';

export const LINK_KEYS_FILE_VAR = 'TITAN_LINK_KEYS_FILE';
export const LINK_KEYS_JSON_VAR = 'TITAN_LINK_KEYS_JSON';

const KID = /^[A-Za-z0-9._-]{1,64}$/;
const ED25519_X = /^[A-Za-z0-9_-]{43}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const SET_FIELDS = ['productId', 'keys'];
const KEY_FIELDS = ['kid', 'alg', 'jwk', 'notBefore', 'notAfter'];
const JWK_FIELDS = ['kty', 'crv', 'x'];
const present = v => v !== undefined && v !== '';
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Returns the validated key sets, or null when neither variable is set. Throws on any malformed setting. */
export function readLinkKeySets(env, { readFile = path => readFileSync(path, 'utf8') } = {}) {
  const fromFile = present(env[LINK_KEYS_FILE_VAR]);
  const fromJson = present(env[LINK_KEYS_JSON_VAR]);
  if (!fromFile && !fromJson) return null;
  if (fromFile && fromJson) throw new Error(`set only one of ${LINK_KEYS_FILE_VAR} or ${LINK_KEYS_JSON_VAR}`);
  const source = fromFile ? LINK_KEYS_FILE_VAR : LINK_KEYS_JSON_VAR;
  let text;
  if (fromFile) {
    try { text = readFile(env[LINK_KEYS_FILE_VAR]); } catch { throw new Error(`${source}: file cannot be read`); }
  } else {
    text = env[LINK_KEYS_JSON_VAR];
  }
  let parsed;
  try { parsed = JSON.parse(String(text)); } catch { throw new Error(`${source}: content is not valid JSON`); }
  return validateLinkKeySets(parsed, source);
}

/** Validates the parsed configuration. Exported for tests; the rules are listed in docs/LINKING.md. */
export function validateLinkKeySets(value, source = 'link keys') {
  const at = (path, rule) => new Error(`${source}: ${path ? `${path} ` : ''}${rule}`);
  if (!Array.isArray(value) || value.length < 1 || value.length > PRODUCT_IDS.length) throw at('', 'must be an array with one entry per product');
  const products = new Set();
  const sets = value.map((set, i) => {
    const p = `products[${i}]`;
    if (!isObject(set)) throw at(p, 'must be an object');
    for (const field of Object.keys(set)) if (!SET_FIELDS.includes(field)) throw at(p, `has unknown field "${field}"`);
    if (!PRODUCT_IDS.includes(set.productId)) throw at(`${p}.productId`, 'must be a known product');
    if (products.has(set.productId)) throw at(`${p}.productId`, 'is listed more than once');
    products.add(set.productId);
    if (!Array.isArray(set.keys) || set.keys.length < 1 || set.keys.length > LINK_ASSERTION_MAX_KEYS_PER_PRODUCT) {
      throw at(`${p}.keys`, `must hold 1 to ${LINK_ASSERTION_MAX_KEYS_PER_PRODUCT} keys`);
    }
    const kids = new Set();
    const keys = set.keys.map((key, j) => {
      const k = `${p}.keys[${j}]`;
      if (!isObject(key)) throw at(k, 'must be an object');
      for (const field of Object.keys(key)) if (!KEY_FIELDS.includes(field)) throw at(k, `has unknown field "${field}"`);
      if (typeof key.kid !== 'string' || !KID.test(key.kid)) throw at(`${k}.kid`, 'must be 1 to 64 letters, digits, dots, underscores or hyphens');
      if (kids.has(key.kid)) throw at(`${k}.kid`, 'is duplicated within its product');
      kids.add(key.kid);
      if (key.alg !== 'EdDSA') throw at(`${k}.alg`, 'must be EdDSA');
      if (!isObject(key.jwk)) throw at(`${k}.jwk`, 'must be an object');
      for (const field of Object.keys(key.jwk)) if (!JWK_FIELDS.includes(field)) throw at(`${k}.jwk`, `must hold only kty, crv and x (found "${field}")`);
      if (key.jwk.kty !== 'OKP') throw at(`${k}.jwk.kty`, 'must be OKP');
      if (key.jwk.crv !== 'Ed25519') throw at(`${k}.jwk.crv`, 'must be Ed25519');
      if (typeof key.jwk.x !== 'string' || !ED25519_X.test(key.jwk.x) || Buffer.from(key.jwk.x, 'base64url').length !== 32) {
        throw at(`${k}.jwk.x`, 'must be a 32-byte Ed25519 public key in base64url');
      }
      if (typeof key.notBefore !== 'string' || !RFC3339.test(key.notBefore) || !Number.isFinite(Date.parse(key.notBefore))) {
        throw at(`${k}.notBefore`, 'must be an RFC 3339 time with an offset');
      }
      if (key.notAfter !== undefined) {
        if (typeof key.notAfter !== 'string' || !RFC3339.test(key.notAfter) || !Number.isFinite(Date.parse(key.notAfter))) {
          throw at(`${k}.notAfter`, 'must be an RFC 3339 time with an offset');
        }
        if (Date.parse(key.notAfter) <= Date.parse(key.notBefore)) throw at(`${k}.notAfter`, 'must be later than notBefore');
      }
      return { kid: key.kid, alg: 'EdDSA', jwk: { kty: 'OKP', crv: 'Ed25519', x: key.jwk.x }, notBefore: key.notBefore, ...(key.notAfter !== undefined ? { notAfter: key.notAfter } : {}) };
    });
    return { productId: set.productId, keys };
  });
  // The control-plane verifier applies the same rules again and is the authority; this catches any drift between them.
  try { new LinkAssertionVerifier(sets, { consume: async () => true }); } catch (e) { throw new Error(`${source}: rejected by the link verifier (${e.message})`); }
  return sets;
}
