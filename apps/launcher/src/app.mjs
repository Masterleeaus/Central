import { readFileSync } from 'node:fs';
import { checkProductAccess } from './access.mjs';
import { page, signedOutBody, launcherBody, notFoundBody } from './render.mjs';

const CSS = readFileSync(new URL('../public/launcher.css', import.meta.url), 'utf8');
const CSP = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

const sendHtml = (res, status, html) => {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
};
const sendText = (res, status, text, extra = {}) => {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8', ...extra });
  res.end(text);
};

/** A session is usable only with a non-empty organisation and access token. Anything else is treated as signed out. */
const validSession = (session) => session && typeof session === 'object'
  && typeof session.organisationId === 'string' && session.organisationId.length > 0
  && typeof session.accessToken === 'string' && session.accessToken.length > 0;

/**
 * Builds the launcher request handler.
 * resolveSession(req) must return null or { organisationId, accessToken, companyName? } for the signed-in user.
 * The handler never reads organisation or product choices from the request; those come only from the session and config.
 */
export function createLauncherHandler({ config, resolveSession, fetchImpl = globalThis.fetch, logger = () => {} }) {
  if (typeof resolveSession !== 'function') throw new TypeError('resolveSession is required');
  const audit = (event, fields = {}) => { try { logger(event, fields); } catch { /* logging never changes the response */ } };

  async function currentSession(req) {
    try {
      const session = await resolveSession(req);
      return validSession(session) ? session : null;
    } catch (error) {
      audit('session_resolve_failed', { error_class: error?.name });
      return null;
    }
  }

  const signInHref = config.signIn.applicationId
    ? `${config.centralOrigin}/auth/titan/${config.signIn.applicationId}/start`
    : null;

  async function renderHome(req, res) {
    const session = await currentSession(req);
    if (!session) return sendHtml(res, 200, page({ title: 'Sign in - Titan Central', body: signedOutBody({ signInHref }) }));

    const results = await Promise.all(config.products.map((product) => checkProductAccess({
      fetchImpl, centralOrigin: config.centralOrigin, session, product, timeoutMs: config.timeoutMs,
    })));
    if (results.some((result) => result.state === 'expired')) {
      return sendHtml(res, 200, page({
        title: 'Sign in - Titan Central',
        body: signedOutBody({ signInHref, message: 'Your session has ended. Sign in again.' }),
      }));
    }
    audit('launcher_render', { products: config.products.map((p, i) => ({ id: p.id, state: results[i].state, reason: results[i].reason })) });
    const products = config.products.map((product, i) => ({ product, state: results[i].state }));
    const body = launcherBody({
      companyName: typeof session.companyName === 'string' && session.companyName ? session.companyName : 'Your selected company',
      switchUrl: config.organisationSwitch?.url ?? null,
      products,
    });
    return sendHtml(res, 200, page({ title: 'Your products - Titan Central', body }));
  }

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://launcher.local');
    const path = url.pathname;

    if (path === '/healthz') {
      if (req.method !== 'GET') return sendText(res, 405, 'method not allowed', { allow: 'GET' });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(JSON.stringify({ status: 'ok' }));
    }
    if (path === '/assets/launcher.css') {
      if (req.method !== 'GET') return sendText(res, 405, 'method not allowed', { allow: 'GET' });
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP });
      return res.end(CSS);
    }
    if (path === '/') {
      if (req.method !== 'GET') return sendText(res, 405, 'method not allowed', { allow: 'GET' });
      return renderHome(req, res);
    }
    return sendHtml(res, 404, page({ title: 'Not found - Titan Central', body: notFoundBody() }));
  }

  return async function launcherHandler(req, res) {
    try {
      await route(req, res);
    } catch (error) {
      audit('request_failed', { error_class: error?.name });
      if (!res.headersSent) sendText(res, 500, 'internal error');
      else res.end();
    }
  };
}
