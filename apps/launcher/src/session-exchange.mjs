/**
 * Session resolver backed by Central's GET /v1/launcher/session (issue #72).
 *
 * Only the browser's Cookie header is forwarded, and only to the configured Central origin. The response must be
 * an HTTP 200 whose body is exactly one organisation ID and one bearer token. Anything else is signed out (null).
 * A transport failure or unexpected status throws, so the handler logs the error class and still shows the
 * signed-out page. The token is never logged or returned to the browser.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_.~+/=-]{16,4096}$/;
export const SESSION_EXCHANGE_PATH = '/v1/launcher/session';

export class SessionExchangeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SessionExchangeError';
    this.status = status;
  }
}

/** Returns a frozen { organisationId, accessToken, companyName? } or null when the body is not a complete session. */
export function parseExchangeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (typeof body.organisationId !== 'string' || !UUID.test(body.organisationId)) return null;
  if (typeof body.accessToken !== 'string' || !TOKEN.test(body.accessToken)) return null;
  if (body.companyName !== undefined && (typeof body.companyName !== 'string' || body.companyName.length === 0 || body.companyName.length > 120)) return null;
  return Object.freeze({
    organisationId: body.organisationId,
    accessToken: body.accessToken,
    ...(typeof body.companyName === 'string' ? { companyName: body.companyName } : {}),
  });
}

/**
 * createSessionExchangeResolver({ centralOrigin, fetchImpl, timeoutMs }) returns resolveSession(req).
 * centralOrigin must already be a validated https origin (config.mjs does that).
 */
export function createSessionExchangeResolver({ centralOrigin, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  if (typeof centralOrigin !== 'string' || !centralOrigin) throw new TypeError('centralOrigin is required');
  const url = new URL(SESSION_EXCHANGE_PATH, centralOrigin);

  return async function resolveSession(req) {
    const cookie = req?.headers?.cookie;
    if (typeof cookie !== 'string' || cookie.length === 0) return null;

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json', cookie },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SessionExchangeError('exchange_unreachable', null);
    }
    if (response.status === 401) return null;
    if (response.status !== 200) throw new SessionExchangeError('exchange_http_status', response.status);

    let body = null;
    try { body = await response.json(); } catch { return null; }
    return parseExchangeBody(body);
  };
}
