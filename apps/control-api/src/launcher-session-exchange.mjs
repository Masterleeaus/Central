/**
 * Launcher session exchange (issue #72, code side only).
 *
 * GET /v1/launcher/session lets the launcher server turn the browser's launcher sign-in session into the
 * organisation ID and bearer token it needs for GET /v1/access/check. The browser never receives the token:
 * the launcher server makes this call, forwarding only the browser's Cookie header.
 *
 * The session lookup is injected as loadSession(req). Central does not ship one yet, so the route is not
 * mounted in server.mjs and answers 404 there. Before mounting, the owner must decide who may call this route
 * (see docs/LAUNCHER_OIDC.md) and the proxy must never publish it.
 *
 * Fails closed: anything other than a complete, well-formed session answers 401, and a loader failure answers 503.
 * Responses and logs never include the token.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_.~+/=-]{16,4096}$/;
const PATH = '/v1/launcher/session';
const noStore = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };

function respond(res, status, body, extra = {}) {
  res.writeHead(status, { ...noStore, ...extra });
  res.end(JSON.stringify(body));
}

/** Returns a frozen { organisationId, accessToken, companyName } or null when the loaded value is not a usable session. */
export function validLauncherSession(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.organisationId !== 'string' || !UUID.test(value.organisationId)) return null;
  if (typeof value.accessToken !== 'string' || !TOKEN.test(value.accessToken)) return null;
  let companyName;
  if (value.companyName !== undefined) {
    if (typeof value.companyName !== 'string' || value.companyName.length === 0 || value.companyName.length > 120) return null;
    companyName = value.companyName;
  }
  return Object.freeze({ organisationId: value.organisationId, accessToken: value.accessToken, ...(companyName ? { companyName } : {}) });
}

/**
 * Returns an async handler(req, res) that resolves true when it handled the request, false otherwise.
 * loadSession(req) must return null for a signed-out browser, or the session object for a signed-in one.
 */
export function createLauncherSessionExchange({ loadSession, logger = () => {} } = {}) {
  if (typeof loadSession !== 'function') throw new TypeError('loadSession is required');
  const audit = (event, fields = {}) => { try { logger(event, fields); } catch { /* logging never changes the response */ } };

  return async function launcherSessionExchange(req, res) {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== PATH) return false;
    if (req.method !== 'GET') { respond(res, 405, { error: 'method_not_allowed' }, { allow: 'GET' }); return true; }

    let session;
    try {
      session = await loadSession(req);
    } catch (error) {
      audit('launcher_session_unavailable', { error_class: error?.name });
      respond(res, 503, { error: 'session_unavailable' });
      return true;
    }
    if (session === null || session === undefined) { respond(res, 401, { error: 'unauthenticated' }); return true; }

    const valid = validLauncherSession(session);
    if (!valid) {
      audit('launcher_session_invalid');
      respond(res, 401, { error: 'unauthenticated' });
      return true;
    }
    respond(res, 200, valid);
    return true;
  };
}
