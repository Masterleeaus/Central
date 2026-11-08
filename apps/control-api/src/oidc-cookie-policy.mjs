/** Explicit cookie policy for OIDC browser cookies (issue #31).
 * Cookies are built ONLY from a policy object, and any Set-Cookie string supplied by a
 * caller is validated against the same policy before it is trusted. Every accepted cookie is:
 * exact name, host-only (no Domain attribute), Path=/, Secure, HttpOnly, SameSite=Lax or
 * Strict, and a bounded Max-Age. SameSite=None, Domain, Expires, duplicate attributes,
 * unknown attributes, control characters (CR/LF included) and any other name are refused.
 */
const CONTROL = /[\x00-\x1f\x7f]/;
const MAX_SET_COOKIE_LENGTH = 512;
const APP_IDS = new Set(['desk', 'field', 'academy']);
const SAME_SITE = new Set(['Lax', 'Strict']);
const REQUIRED_ATTRIBUTES = ['path', 'secure', 'httponly', 'samesite', 'max-age'];
const MAX_AGE = /^(0|[1-9][0-9]{0,5})$/;

function assertApp(applicationId) {
  if (!APP_IDS.has(applicationId)) throw new TypeError('invalid cookie policy application');
}

/** Browser binding for the login round trip. Name is fixed per application. */
export function bindingCookiePolicy(applicationId) {
  assertApp(applicationId);
  return Object.freeze({ name: `titan_${applicationId}_oidc_binding`, valuePattern: /^[A-Za-z0-9_-]{43}$/, minAge: 1, maxAge: 600 });
}

/** App-owned session cookie. Name must be exactly `${applicationId}_sid`, so one app cannot set another app's session. */
export function appSessionCookiePolicy(applicationId) {
  assertApp(applicationId);
  return Object.freeze({ name: `${applicationId}_sid`, valuePattern: /^[A-Za-z0-9_-]{32,256}$/, minAge: 60, maxAge: 86400 });
}

/** Build a Set-Cookie value. Throws rather than emitting anything outside the policy. */
export function buildPolicyCookie(policy, value, maxAge) {
  if (typeof value !== 'string' || !policy.valuePattern.test(value)) throw new TypeError('cookie value violates policy');
  if (!Number.isInteger(maxAge) || maxAge < policy.minAge || maxAge > policy.maxAge) throw new TypeError('cookie max-age violates policy');
  return `${policy.name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Expiring clear cookie for the same policy name and attributes. */
export function buildClearCookie(policy) {
  return `${policy.name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** True only if the Set-Cookie string is exactly what the policy allows. Never throws. */
export function isPolicySetCookie(policy, setCookie) {
  try {
    if (typeof setCookie !== 'string' || setCookie.length > MAX_SET_COOKIE_LENGTH || CONTROL.test(setCookie)) return false;
    const parts = setCookie.split(';').map(part => part.trim());
    const pair = parts[0];
    const eq = pair.indexOf('=');
    if (eq < 1) return false;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (name !== policy.name) return false;
    const seen = new Set();
    let maxAge = null;
    for (const attribute of parts.slice(1)) {
      if (!attribute) return false;
      const at = attribute.indexOf('=');
      const key = (at < 0 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
      const arg = at < 0 ? null : attribute.slice(at + 1).trim();
      if (seen.has(key)) return false;
      seen.add(key);
      switch (key) {
        case 'path': if (arg !== '/') return false; break;
        case 'secure':
        case 'httponly': if (arg !== null) return false; break;
        case 'samesite': if (!SAME_SITE.has(arg)) return false; break;
        case 'max-age': if (arg === null || !MAX_AGE.test(arg)) return false; maxAge = Number(arg); break;
        default: return false; // Domain, Expires, Partitioned, and any unknown attribute
      }
    }
    if (!REQUIRED_ATTRIBUTES.every(required => seen.has(required))) return false;
    if (value === '') return maxAge === 0; // clearing cookie only
    return policy.valuePattern.test(value) && maxAge >= policy.minAge && maxAge <= policy.maxAge;
  } catch {
    return false;
  }
}
