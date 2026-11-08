/** Endpoint transport policy shared by the OIDC modules.
 * https is always required. http://localhost is accepted ONLY when the explicit
 * development flag TITAN_ALLOW_INSECURE_LOCALHOST=1 is set. Production never sets it. */
export const INSECURE_LOCALHOST_ENV = 'TITAN_ALLOW_INSECURE_LOCALHOST';
export const insecureLocalhostAllowed = (env = process.env) => env[INSECURE_LOCALHOST_ENV] === '1';
export function isSecureEndpoint(value, allowInsecureLocalhost = false) {
  if (typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' || (allowInsecureLocalhost === true && url.protocol === 'http:' && url.hostname === 'localhost');
}
