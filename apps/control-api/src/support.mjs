/** Support console read API (issue #39). Read-only, role-scoped, time-bounded and audited.
 *
 * Routes (all under /v1/support/, mounted only when a supportHandler is passed to createCentralHandler):
 *   GET  /v1/support/organisations?logto_organisation_id=<id>  support role. Exact lookup. Returns the Central id only.
 *   POST /v1/support/grants                                    support role. Issues a short-lived grant for ONE organisation.
 *   GET  /v1/support/organisations/{organisationId}            support role AND a valid grant for that organisation.
 * Every other method or path is refused. No route writes anything except the audit record of the call itself.
 *
 * Order of checks for the overview: bearer token (401) -> support role via the Logto authoriser (403, 503 if
 * authority is unreachable) -> grant signature, subject, organisation, scope and expiry (403) -> organisation exists
 * -> audit record written (fails closed: 503, no data) -> Central read -> product signals (degrade, never block).
 *
 * Grants: HMAC-SHA256 signed by the server, carried in the X-Support-Grant header, with a lifetime of at most
 * SUPPORT_GRANT_MAX_TTL_SECONDS. A grant cannot be revoked early; it expires. Authority is still re-checked on every
 * read, so removing the support role takes effect at once. See docs/SUPPORT_CONSOLE.md.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
 findOrganisationById,
 findOrganisationByLogtoId,
 readSupportCentralSnapshot,
 recordActivityInOwnTransaction,
 SUPPORT_ACTIVITY_LIMIT_MAX,
} from '../../../packages/control-plane/dist/index.js';

export const SUPPORT_GRANT_HEADER = 'x-support-grant';
export const SUPPORT_SCOPE = 'support:read';
export const SUPPORT_GRANT_TTL_SECONDS = 600;
export const SUPPORT_GRANT_MAX_TTL_SECONDS = 900;
export const SUPPORT_REASONS = Object.freeze(['setup_diagnosis', 'integration_health', 'provisioning_check']);
export const SUPPORT_PRODUCT_TIMEOUT_MS = 1500;
const MIN_KEY_BYTES = 32;
const CLOCK_SKEW_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOGTO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const PRODUCT_STATUSES = ['ok', 'degraded', 'down'];

const baseHeaders = Object.freeze({ 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
const send = (res, status, body, extra = {}) => { res.writeHead(status, { ...baseHeaders, ...extra }); res.end(JSON.stringify(body)); };
const bearer = (req) => { const h = req.headers.authorization; return typeof h === 'string' && /^Bearer [A-Za-z0-9_.-]+$/.test(h) ? h.slice(7) : undefined; };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function keyBytes(key) {
 const buf = typeof key === 'string' ? Buffer.from(key, 'utf8') : Buffer.isBuffer(key) ? key : null;
 if (!buf || buf.length < MIN_KEY_BYTES) throw new Error(`support grant key must be at least ${MIN_KEY_BYTES} bytes`);
 return buf;
}

/** Signs a grant for one subject and one organisation. The payload carries no personal data. */
export function signSupportGrant({ key, subject, organisationId, issuedAt, ttlSeconds = SUPPORT_GRANT_TTL_SECONDS }) {
 const mac = keyBytes(key);
 if (typeof subject !== 'string' || !LOGTO_ID.test(subject)) throw new Error('invalid grant subject');
 if (!UUID.test(organisationId)) throw new Error('invalid grant organisation');
 if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > SUPPORT_GRANT_MAX_TTL_SECONDS) throw new Error('invalid grant lifetime');
 const payload = { v: 1, sub: subject, org: organisationId, scope: SUPPORT_SCOPE, iat: issuedAt, exp: issuedAt + ttlSeconds, jti: randomUUID() };
 const body = b64u(JSON.stringify(payload));
 const sig = b64u(createHmac('sha256', mac).update(body).digest());
 return `${body}.${sig}`;
}

/** Verifies a grant. Returns {ok:true, payload} or {ok:false, reason}. `nowSeconds` is injected. Never throws. */
export function verifySupportGrant({ key, token, subject, organisationId, nowSeconds }) {
 if (typeof token !== 'string' || token.length === 0 || token.length > 1024) return { ok: false, reason: 'malformed' };
 const parts = token.split('.');
 if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: 'malformed' };
 const [body, sig] = parts;
 let expected;
 try { expected = createHmac('sha256', keyBytes(key)).update(body).digest(); } catch { return { ok: false, reason: 'not_configured' }; }
 const given = Buffer.from(sig, 'base64url');
 if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' };
 let p;
 try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
 if (!isObject(p) || p.v !== 1 || p.scope !== SUPPORT_SCOPE || !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) || typeof p.jti !== 'string') return { ok: false, reason: 'malformed' };
 if (p.exp <= p.iat || p.exp - p.iat > SUPPORT_GRANT_MAX_TTL_SECONDS) return { ok: false, reason: 'malformed' };
 if (p.sub !== subject) return { ok: false, reason: 'subject_mismatch' };
 if (p.org !== organisationId) return { ok: false, reason: 'organisation_mismatch' };
 if (nowSeconds < p.iat - CLOCK_SKEW_SECONDS) return { ok: false, reason: 'not_yet_valid' };
 if (nowSeconds >= p.exp) return { ok: false, reason: 'expired' };
 return { ok: true, payload: p };
}

/** Real store backed by the control-plane read functions. Tests inject a fake with the same four methods. */
export function createPostgresSupportStore(pool) {
 return Object.freeze({
  findOrganisationById: (id) => findOrganisationById(pool, id),
  findOrganisationByLogtoId: (id) => findOrganisationByLogtoId(pool, id),
  readCentral: (organisationId, options) => readSupportCentralSnapshot(pool, organisationId, options),
  recordAudit: (input) => recordActivityInOwnTransaction(pool, input),
 });
}

const dateOrNull = (v) => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** Product health from another product. Never trusts extra fields: only a status and a checked-at time are kept. */
async function productSignal(productStatus, productId, organisationId, timeoutMs) {
 if (typeof productStatus !== 'function') return { freshness: 'unavailable', reason: 'not_integrated' };
 let timer;
 try {
  const report = await Promise.race([
   Promise.resolve().then(() => productStatus(productId, organisationId)),
   new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
  ]);
  if (!isObject(report) || !PRODUCT_STATUSES.includes(report.status)) return { freshness: 'unavailable', reason: 'invalid_response' };
  return { freshness: 'live', status: report.status, checkedAt: dateOrNull(report.checkedAt) };
 } catch (e) {
  return { freshness: 'unavailable', reason: e?.message === 'timeout' ? 'timeout' : 'product_unreachable' };
 } finally { clearTimeout(timer); }
}

/** Builds the overview body from Central's snapshot and the product signals. Pure. */
export function buildSupportOverview({ central, healthSignals, readAt }) {
 const products = central.products.map((p, i) => ({
  product: p.productId,
  legacyApplicationId: p.applicationId,
  entitlement: p.entitlement,
  links: p.links,
  health: healthSignals[i],
  provisioning: { freshness: 'unavailable', reason: 'not_integrated' },
 }));
 const healthLive = healthSignals.filter((s) => s.freshness === 'live').length;
 const healthSummary = healthLive === healthSignals.length ? 'live' : healthLive === 0 ? 'unavailable' : 'partial';
 return {
  generatedAt: readAt,
  organisation: central.organisation,
  memberships: central.memberships,
  products,
  activity: central.activity,
  sources: {
   central: { freshness: 'live', readAt: central.readAt },
   activity: { freshness: 'live', readAt: central.readAt },
   productHealth: { freshness: healthSummary },
   productProvisioning: { freshness: 'unavailable', reason: 'not_integrated' },
  },
  // True whenever any product section is not live. The Central data above is still complete.
  degraded: products.some((p) => p.health.freshness !== 'live' || p.provisioning.freshness !== 'live'),
 };
}

/**
 * Support read handler. Returns false for paths outside /v1/support/ so the caller can route on.
 * authoriseSupport(principal) must answer through the existing Logto authoriser, configured with the SUPPORT role IDs.
 * store: {findOrganisationById, findOrganisationByLogtoId, readCentral, recordAudit} (createPostgresSupportStore in production).
 * productStatus(productId, organisationId): optional live product health. Failures and slow answers degrade the view.
 */
export function createSupportHandler({
 verifyToken, authoriseSupport, store, grantKey, clock = () => Date.now(), logger = () => {},
 productStatus, productTimeoutMs = SUPPORT_PRODUCT_TIMEOUT_MS, activityLimit = 20,
} = {}) {
 if (typeof verifyToken !== 'function' || typeof authoriseSupport !== 'function') throw new Error('support verification and authoriser required');
 if (!store || ![store.findOrganisationById, store.findOrganisationByLogtoId, store.readCentral, store.recordAudit].every((f) => typeof f === 'function')) throw new Error('support store required');
 keyBytes(grantKey); // fail at construction, not at the first request
 if (!Number.isSafeInteger(activityLimit) || activityLimit < 1 || activityLimit > SUPPORT_ACTIVITY_LIMIT_MAX) throw new Error('invalid activity limit');
 const log = (event, fields) => { try { logger(event, fields); } catch { /* logging never alters the outcome */ } };

 const audit = (principal, organisationId, action, outcome, detail) => store.recordAudit({
  organisationId,
  actorKind: 'subject',
  actorId: principal.logtoSubject,
  action,
  targetType: 'organisation',
  targetId: organisationId,
  sourceProduct: 'central',
  outcome,
  correlationId: randomUUID(),
  detail,
 });

 /** Best effort for denials: records a denied attempt when the organisation exists. Never changes the response. */
 async function auditDenied(principal, organisationId, action, reason) {
  try {
   const org = await store.findOrganisationById(organisationId);
   if (!org) { log('support_denied_unknown_organisation', { action, reason }); return; }
   await audit(principal, organisationId, action, 'denied', { reason });
  } catch (e) { log('support_denial_audit_failed', { action, error_class: e?.name }); }
 }

 async function authority(principal) {
  try { return (await authoriseSupport(principal)) === true ? 'allowed' : 'denied'; }
  catch { return 'unavailable'; }
 }

 async function authenticate(req, res) {
  const token = bearer(req);
  if (!token) { send(res, 401, { error: 'unauthenticated' }); return null; }
  try {
   const principal = await verifyToken(token);
   if (typeof principal?.logtoSubject !== 'string' || !principal.logtoSubject) throw new Error('bad principal');
   return principal;
  } catch { send(res, 401, { error: 'unauthenticated' }); return null; }
 }

 async function requireSupportRole(principal, res, action, organisationId) {
  const decision = await authority(principal);
  if (decision === 'unavailable') { log('support_authority_unavailable', { action }); send(res, 503, { error: 'authority_unavailable' }); return false; }
  if (decision === 'denied') {
   log('support_forbidden', { action });
   if (organisationId) await auditDenied(principal, organisationId, action, 'support_role');
   send(res, 403, { error: 'forbidden' });
   return false;
  }
  return true;
 }

 async function readBody(req, maxBytes = 1024) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new Error('unsupported_media_type');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw new Error('payload_too_large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('invalid_json'); }
 }

 async function handleLookup(req, res, principal, url) {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'logto_organisation_id' || url.searchParams.getAll(keys[0]).length !== 1) return send(res, 400, { error: 'invalid_parameters' });
  const logtoId = url.searchParams.get('logto_organisation_id');
  if (!LOGTO_ID.test(logtoId)) return send(res, 400, { error: 'invalid_parameters' });
  const action = 'support.organisation.lookup';
  if (!(await requireSupportRole(principal, res, action, null))) return;
  const org = await store.findOrganisationByLogtoId(logtoId);
  if (!org) { log('support_lookup_unmatched', { action }); return send(res, 404, { error: 'not_found' }); }
  try { await audit(principal, org.id, action, 'success', { view: 'lookup' }); }
  catch { log('support_audit_failed', { action }); return send(res, 503, { error: 'audit_unavailable' }); }
  return send(res, 200, { organisationId: org.id });
 }

 async function handleGrant(req, res, principal) {
  const action = 'support.grant.issue';
  if (!(await requireSupportRole(principal, res, action, null))) return;
  let body;
  try { body = await readBody(req); }
  catch (e) { return send(res, e.message === 'payload_too_large' ? 413 : e.message === 'unsupported_media_type' ? 415 : 400, { error: e.message }); }
  if (!isObject(body) || Object.keys(body).some((k) => !['organisationId', 'reason'].includes(k)) || !UUID.test(body.organisationId) || !SUPPORT_REASONS.includes(body.reason)) {
   return send(res, 400, { error: 'invalid_grant_request' });
  }
  const org = await store.findOrganisationById(body.organisationId);
  if (!org) { log('support_grant_unknown_organisation', { action }); return send(res, 404, { error: 'not_found' }); }
  const issuedAt = Math.floor(clock() / 1000);
  try {
   // Fail closed: the grant is issued only after the issuance is on record.
   await audit(principal, org.id, action, 'success', { reason: body.reason, ttl_seconds: SUPPORT_GRANT_TTL_SECONDS });
  } catch { log('support_audit_failed', { action }); return send(res, 503, { error: 'audit_unavailable' }); }
  const grant = signSupportGrant({ key: grantKey, subject: principal.logtoSubject, organisationId: org.id, issuedAt, ttlSeconds: SUPPORT_GRANT_TTL_SECONDS });
  return send(res, 201, { grant, scope: SUPPORT_SCOPE, organisationId: org.id, expiresAt: new Date((issuedAt + SUPPORT_GRANT_TTL_SECONDS) * 1000).toISOString() });
 }

 async function handleOverview(req, res, principal, organisationId, url) {
  const action = 'support.organisation.view';
  if (url.search !== '') return send(res, 400, { error: 'unexpected_query' });
  if (!(await requireSupportRole(principal, res, action, organisationId))) return;
  const token = req.headers[SUPPORT_GRANT_HEADER];
  const nowSeconds = Math.floor(clock() / 1000);
  const checked = token === undefined
   ? { ok: false, reason: 'missing' }
   : verifySupportGrant({ key: grantKey, token, subject: principal.logtoSubject, organisationId, nowSeconds });
  if (!checked.ok) {
   log('support_grant_refused', { reason: checked.reason });
   await auditDenied(principal, organisationId, action, `grant_${checked.reason}`);
   return send(res, 403, { error: checked.reason === 'expired' ? 'support_grant_expired' : checked.reason === 'missing' ? 'support_grant_required' : 'support_grant_invalid' });
  }
  const org = await store.findOrganisationById(organisationId);
  if (!org) { log('support_read_unknown_organisation', { action }); return send(res, 404, { error: 'not_found' }); }
  const now = new Date(clock());
  try {
   await audit(principal, organisationId, action, 'success', { view: 'overview', activity_limit: activityLimit });
  } catch { log('support_audit_failed', { action }); return send(res, 503, { error: 'audit_unavailable' }); }
  let central;
  try {
   central = await store.readCentral(organisationId, { now, activityLimit });
  } catch (e) { log('support_read_failed', { action, error_class: e?.name }); return send(res, 503, { error: 'central_unavailable' }); }
  if (!central) return send(res, 404, { error: 'not_found' });
  // Defence in depth: the read is scoped in SQL, and a snapshot for any other organisation is never returned.
  if (central.organisation?.id !== organisationId) { log('support_read_scope_violation', { action }); return send(res, 503, { error: 'central_unavailable' }); }
  const healthSignals = await Promise.all(central.products.map((p) => productSignal(productStatus, p.productId, organisationId, productTimeoutMs)));
  return send(res, 200, buildSupportOverview({ central, healthSignals, readAt: now.toISOString() }));
 }

 return async function supportHandler(req, res) {
  let url;
  try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { send(res, 400, { error: 'invalid_url' }); return true; }
  const path = url.pathname;
  if (!path.startsWith('/v1/support/')) return false;
  try {
   if (path === '/v1/support/grants') {
    if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' }); return true; }
    const principal = await authenticate(req, res); if (principal) await handleGrant(req, res, principal);
    return true;
   }
   if (path === '/v1/support/organisations') {
    if (req.method !== 'GET') { send(res, 405, { error: 'method_not_allowed' }, { allow: 'GET' }); return true; }
    const principal = await authenticate(req, res); if (principal) await handleLookup(req, res, principal, url);
    return true;
   }
   const match = path.match(/^\/v1\/support\/organisations\/([^/]+)$/);
   if (match) {
    if (req.method !== 'GET') { send(res, 405, { error: 'method_not_allowed' }, { allow: 'GET' }); return true; }
    if (!UUID.test(match[1])) { send(res, 400, { error: 'invalid_organisation_id' }); return true; }
    const principal = await authenticate(req, res);
    if (principal) await handleOverview(req, res, principal, match[1].toLowerCase(), url);
    return true;
   }
   send(res, 404, { error: 'not_found' });
   return true;
  } catch (error) {
   log('support_request_failed', { error_class: error?.name });
   try { if (!res.headersSent) send(res, 503, { error: 'support_unavailable' }); else res.end(); } catch { /* socket gone */ }
   return true;
  }
 };
}
