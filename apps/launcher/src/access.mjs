/** The action the launcher asks Central about for each product (the product's entry action in packages/control-plane applications.ts). */
export const ACCESS_ACTION = 'session:open';
const REASON_CODE = /^[a-z][a-z_]{0,39}$/;

const unavailable = (reason) => Object.freeze({ state: 'unavailable', reason });

/**
 * Server-side call to Central's GET /v1/access/check for one product.
 * Only an HTTP 200 whose body says allowed === true yields 'available'. Anything else is
 * 'denied' (403 with allowed === false), 'expired' (401) or 'unavailable'. Fails closed.
 * The access token is sent only in the Authorization header and is never returned or logged.
 */
export async function checkProductAccess({ fetchImpl, centralOrigin, session, product, timeoutMs }) {
  const url = new URL('/v1/access/check', centralOrigin);
  url.searchParams.set('organisation_id', session.organisationId);
  url.searchParams.set('application', product.legacyApplication);
  url.searchParams.set('action', ACCESS_ACTION);

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json', authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return unavailable('network_error');
  }

  let body = null;
  try { body = await response.json(); } catch { body = null; }
  const isObject = body !== null && typeof body === 'object';

  if (response.status === 401) return Object.freeze({ state: 'expired', reason: 'unauthenticated' });
  if (response.status === 200 && isObject && body.allowed === true) return Object.freeze({ state: 'available', reason: 'allowed' });
  if (response.status === 403 && isObject && body.allowed === false) {
    const reason = typeof body.reason === 'string' && REASON_CODE.test(body.reason) ? body.reason : 'denied';
    return Object.freeze({ state: 'denied', reason });
  }
  return unavailable(response.status === 200 ? 'malformed_response' : `http_${response.status}`);
}
