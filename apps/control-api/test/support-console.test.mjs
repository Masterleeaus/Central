import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSupportHandler, signSupportGrant, verifySupportGrant, SUPPORT_GRANT_HEADER, SUPPORT_GRANT_TTL_SECONDS, SUPPORT_GRANT_MAX_TTL_SECONDS } from '../src/support.mjs';
import { createCentralHandler } from '../src/app.mjs';
import { createAdminHandler } from '../src/admin.mjs';

const KEY = 'k'.repeat(40);
const ORG = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const NOW_MS = Date.parse('2026-11-09T10:00:00.000Z');
const NOW_S = NOW_MS / 1000;
const SUPPORT = 'op_support';
const SUPPORT_2 = 'op_support_two';
const ADMIN = 'op_admin';
const PLAIN = 'usr_plain';
const OUTAGE = 'op_outage';
const ORIGINS = { field: 'https://field.titanzero.io', desk: 'https://desk.titanzero.io', academy: 'https://academy.titanzero.io' };

const ORGS = {
 [ORG]: { id: ORG, logtoOrganisationId: 'org_acme', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
 [OTHER]: { id: OTHER, logtoOrganisationId: 'org_other', status: 'active', createdAt: '2026-01-02T00:00:00.000Z' },
};

/** Central snapshot for one organisation, shaped as readSupportCentralSnapshot returns it. */
function centralFor(id) {
 return {
  readAt: '2026-11-09T10:00:00.000Z',
  organisation: ORGS[id],
  memberships: { active: 2, invited: 0, suspended: 0, revoked: 1 },
  products: [
   { productId: 'sorted', applicationId: 'field', entitlement: { status: 'active', expiresAt: '2027-01-01T00:00:00.000Z', expired: false, featureCount: 2 }, links: { verified: 1, revoked: 0 } },
   { productId: 'supercharged', applicationId: 'desk', entitlement: null, links: { verified: 0, revoked: 0 } },
   { productId: 'lms', applicationId: 'academy', entitlement: { status: 'expired', expiresAt: '2026-01-01T00:00:00.000Z', expired: true, featureCount: 0 }, links: { verified: 0, revoked: 1 } },
  ],
  activity: { limit: 20, events: [{ eventId: 'e1', occurredAt: '2026-11-08T09:00:00.000Z', actorKind: 'subject', actorId: 'usr_admin_1', action: 'membership.update', targetType: 'membership', targetId: 'm1', sourceProduct: 'central', outcome: 'success', correlationId: 'corr-0001', detail: { role: 'manager' } }] },
 };
}

/** Fake store. Every call and every audit record is kept, in order, so tests can check sequencing. */
function fakeStore() {
 const store = {
  calls: [], audits: [], failAudit: false, failRead: false, readOverride: undefined,
  async findOrganisationById(id) { store.calls.push(['org', id]); return ORGS[id]; },
  async findOrganisationByLogtoId(id) { store.calls.push(['lookup', id]); return Object.values(ORGS).find((o) => o.logtoOrganisationId === id); },
  async readCentral(id, opts) {
   store.calls.push(['read', id, opts.activityLimit]);
   if (store.failRead) throw new Error('db down');
   return store.readOverride ? store.readOverride(id) : centralFor(id);
  },
  async recordAudit(input) {
   store.calls.push(['audit', input.action, input.outcome]);
   if (store.failAudit) throw new Error('audit down');
   store.audits.push(input);
   return input.correlationId;
  },
 };
 return store;
}

function harness({ store = fakeStore(), productStatus, supportRoles = new Set([SUPPORT, SUPPORT_2]), outage = false } = {}) {
 const logs = [];
 const verifyToken = async (token) => {
  const sub = token.replace(/^tok_/, '');
  if (![SUPPORT, SUPPORT_2, ADMIN, PLAIN, OUTAGE].includes(sub)) throw new Error('bad token');
  return { logtoSubject: sub };
 };
 const authoriseSupport = async (principal) => {
  if (principal.logtoSubject === OUTAGE || outage) throw new Error('logto unreachable');
  return supportRoles.has(principal.logtoSubject);
 };
 const handler = createSupportHandler({
  verifyToken, authoriseSupport, store, grantKey: KEY, clock: () => NOW_MS, productStatus, productTimeoutMs: 50,
  logger: (event, fields) => logs.push({ event, fields }),
 });
 return { handler, store, logs, supportRoles };
}

function fakeReq(method, url, { token, grant, body, contentType } = {}) {
 const headers = {};
 if (token) headers.authorization = `Bearer ${token}`;
 if (grant !== undefined) headers[SUPPORT_GRANT_HEADER] = grant;
 let stream;
 if (body !== undefined) {
  headers['content-type'] = contentType ?? 'application/json';
  stream = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
 } else {
  stream = Readable.from([]);
 }
 return Object.assign(stream, { method, url, headers });
}

function fakeRes() {
 return {
  statusCode: 0, headers: {}, body: undefined, headersSent: false,
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; this.headersSent = true; },
  end(data) { this.body = data === undefined ? undefined : JSON.parse(data); },
 };
}

async function call(handler, method, url, opts) {
 const res = fakeRes();
 const handled = await handler(fakeReq(method, url, opts), res);
 return { handled, status: res.statusCode, body: res.body, headers: res.headers };
}

const token = (sub) => `tok_${sub}`;
const overviewUrl = (id = ORG) => `/v1/support/organisations/${id}`;

async function issueGrant(h, sub = SUPPORT, organisationId = ORG) {
 const r = await call(h.handler, 'POST', '/v1/support/grants', { token: token(sub), body: { organisationId, reason: 'setup_diagnosis' } });
 assert.equal(r.status, 201, JSON.stringify(r.body));
 return r.body.grant;
}

/** Re-encodes a grant with an edited payload. The signature is kept, so verification must fail. */
function withPayload(grant, edit) {
 const [body, sig] = grant.split('.');
 const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
 return `${Buffer.from(JSON.stringify({ ...p, ...edit })).toString('base64url')}.${sig}`;
}

// ---------- read only ----------

test('read only: a support grant reads the overview and nothing else', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 200);
 assert.equal(r.body.organisation.id, ORG);
 const before = h.store.calls.length;
 for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const m = await call(h.handler, method, overviewUrl(), { token: token(SUPPORT), grant, body: method === 'POST' ? {} : undefined });
  assert.equal(m.status, 405, method);
  assert.equal(m.headers.allow, 'GET');
 }
 const lookupWrite = await call(h.handler, 'POST', '/v1/support/organisations?logto_organisation_id=org_acme', { token: token(SUPPORT), body: {} });
 assert.equal(lookupWrite.status, 405);
 const grantRead = await call(h.handler, 'GET', '/v1/support/grants', { token: token(SUPPORT) });
 assert.equal(grantRead.status, 405);
 assert.equal(h.store.calls.length, before, 'refused methods never reach the store');
});

test('read only: unknown support paths are 404 and the grant body accepts only two fields', async () => {
 const h = harness();
 assert.equal((await call(h.handler, 'GET', '/v1/support/organisations/' + ORG + '/provision', { token: token(SUPPORT) })).status, 404);
 assert.equal((await call(h.handler, 'GET', '/v1/support/anything', { token: token(SUPPORT) })).status, 404);
 const extra = await call(h.handler, 'POST', '/v1/support/grants', { token: token(SUPPORT), body: { organisationId: ORG, reason: 'setup_diagnosis', role: 'owner' } });
 assert.equal(extra.status, 400);
 assert.equal(h.store.audits.length, 0);
 assert.equal(h.store.calls.filter(([k]) => k === 'read').length, 0);
});

test('read only: every write the support path can make is an audit record of its own call', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 await call(h.handler, 'GET', '/v1/support/organisations?logto_organisation_id=org_acme', { token: token(SUPPORT) });
 assert.deepEqual(h.store.audits.map((a) => a.action), ['support.grant.issue', 'support.organisation.view', 'support.organisation.lookup']);
 assert.ok(h.store.audits.every((a) => a.sourceProduct === 'central' && a.targetType === 'organisation'));
});

// ---------- expiry ----------

test('expiry: an expired grant is refused, the refusal is audited, and no data is read', async () => {
 const h = harness();
 const stale = signSupportGrant({ key: KEY, subject: SUPPORT, organisationId: ORG, issuedAt: NOW_S - 700, ttlSeconds: 600 });
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant: stale });
 assert.equal(r.status, 403);
 assert.equal(r.body.error, 'support_grant_expired');
 assert.equal(h.store.calls.filter(([k]) => k === 'read').length, 0);
 const denial = h.store.audits.find((a) => a.outcome === 'denied');
 assert.ok(denial, 'denied attempt audited');
 assert.deepEqual(denial.detail, { reason: 'grant_expired' });
});

test('expiry: the boundary is exclusive, and a grant is refused at its exact expiry second', () => {
 const grant = signSupportGrant({ key: KEY, subject: SUPPORT, organisationId: ORG, issuedAt: NOW_S - 600, ttlSeconds: 600 });
 const args = { key: KEY, token: grant, subject: SUPPORT, organisationId: ORG };
 assert.equal(verifySupportGrant({ ...args, nowSeconds: NOW_S - 1 }).ok, true);
 assert.deepEqual(verifySupportGrant({ ...args, nowSeconds: NOW_S }), { ok: false, reason: 'expired' });
});

test('expiry: a grant issued in the future (beyond clock skew) is refused, and lifetimes are bounded', () => {
 const future = signSupportGrant({ key: KEY, subject: SUPPORT, organisationId: ORG, issuedAt: NOW_S + 300, ttlSeconds: 600 });
 assert.equal(verifySupportGrant({ key: KEY, token: future, subject: SUPPORT, organisationId: ORG, nowSeconds: NOW_S }).reason, 'not_yet_valid');
 assert.throws(() => signSupportGrant({ key: KEY, subject: SUPPORT, organisationId: ORG, issuedAt: NOW_S, ttlSeconds: SUPPORT_GRANT_MAX_TTL_SECONDS + 1 }));
 assert.throws(() => signSupportGrant({ key: 'short', subject: SUPPORT, organisationId: ORG, issuedAt: NOW_S }));
 assert.throws(() => createSupportHandler({ verifyToken: async () => ({}), authoriseSupport: async () => true, store: fakeStore(), grantKey: 'short' }));
 assert.equal(SUPPORT_GRANT_TTL_SECONDS <= SUPPORT_GRANT_MAX_TTL_SECONDS, true);
});

test('expiry: a failing product does not change the grant refusal', async () => {
 const h = harness({ productStatus: async () => { throw new Error('ECONNREFUSED'); } });
 const stale = signSupportGrant({ key: KEY, subject: SUPPORT, organisationId: ORG, issuedAt: NOW_S - 700, ttlSeconds: 600 });
 assert.equal((await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant: stale })).status, 403);
});

// ---------- grant binding and tampering ----------

test('binding: a grant works only for its subject and its organisation', async () => {
 const h = harness();
 const grant = await issueGrant(h, SUPPORT, ORG);
 const otherSubject = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT_2), grant });
 assert.equal(otherSubject.status, 403);
 assert.equal(otherSubject.body.error, 'support_grant_invalid');
 const otherOrg = await call(h.handler, 'GET', overviewUrl(OTHER), { token: token(SUPPORT), grant });
 assert.equal(otherOrg.status, 403);
 assert.equal(h.store.calls.filter(([k]) => k === 'read').length, 0);
 assert.ok(h.logs.some((l) => l.fields.reason === 'subject_mismatch'));
 assert.ok(h.logs.some((l) => l.fields.reason === 'organisation_mismatch'));
});

test('binding: a tampered payload, a wrong key, a foreign scope and a missing grant are all refused', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 const extended = withPayload(grant, { exp: NOW_S + 86400 });
 assert.equal((await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant: extended })).body.error, 'support_grant_invalid');
 assert.equal(verifySupportGrant({ key: 'z'.repeat(40), token: grant, subject: SUPPORT, organisationId: ORG, nowSeconds: NOW_S }).reason, 'bad_signature');

 const body = Buffer.from(JSON.stringify({ v: 1, sub: SUPPORT, org: ORG, scope: 'admin:write', iat: NOW_S, exp: NOW_S + 60, jti: 'x' })).toString('base64url');
 const sig = createHmac('sha256', KEY).update(body).digest('base64url');
 assert.equal(verifySupportGrant({ key: KEY, token: `${body}.${sig}`, subject: SUPPORT, organisationId: ORG, nowSeconds: NOW_S }).reason, 'malformed');

 assert.equal(verifySupportGrant({ key: KEY, token: 'not a grant', subject: SUPPORT, organisationId: ORG, nowSeconds: NOW_S }).reason, 'malformed');
 const missing = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT) });
 assert.equal(missing.body.error, 'support_grant_required');
});

// ---------- authority ----------

test('authority: only the support role may issue a grant or read, and a plain or admin subject is refused', async () => {
 const h = harness();
 for (const sub of [PLAIN, ADMIN]) {
  const r = await call(h.handler, 'POST', '/v1/support/grants', { token: token(sub), body: { organisationId: ORG, reason: 'setup_diagnosis' } });
  assert.equal(r.status, 403, sub);
  assert.equal(r.body.grant, undefined);
 }
 assert.equal(h.store.audits.length, 0, 'no organisation was attributed, so nothing was written');
 assert.equal((await call(h.handler, 'GET', '/v1/support/organisations?logto_organisation_id=org_acme', { token: token(ADMIN) })).status, 403);
});

test('authority: removing the support role takes effect on the next read, even with a live grant', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 h.supportRoles.delete(SUPPORT);
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 403);
 assert.equal(r.body.error, 'forbidden');
 assert.equal(h.store.calls.filter(([k]) => k === 'read').length, 0);
});

test('authority: an unreachable authoriser fails closed with 503 and no data', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 const outage = harness({ outage: true, store: h.store });
 const r = await call(outage.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 503);
 assert.equal(r.body.error, 'authority_unavailable');
 assert.equal((await call(outage.handler, 'POST', '/v1/support/grants', { token: token(OUTAGE), body: { organisationId: ORG, reason: 'setup_diagnosis' } })).status, 503);
 assert.equal(h.store.calls.filter(([k]) => k === 'read').length, 0);
});

test('authority: a missing or malformed bearer token is 401 on every route', async () => {
 const h = harness();
 assert.equal((await call(h.handler, 'GET', overviewUrl(), {})).status, 401);
 assert.equal((await call(h.handler, 'GET', overviewUrl(), { token: 'bad' })).status, 401);
 assert.equal((await call(h.handler, 'POST', '/v1/support/grants', { token: 'bad', body: {} })).status, 401);
});

// ---------- audit ----------

test('audit: each read is recorded before its data is read, with no data values in the detail', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 200);
 const order = h.store.calls.map(([k, a, b]) => `${k}:${a}:${b ?? ''}`);
 const auditAt = order.indexOf('audit:support.organisation.view:success');
 const readAt = order.indexOf(`read:${ORG}:20`);
 assert.ok(auditAt >= 0 && readAt > auditAt, order.join(' | '));
 const view = h.store.audits.find((a) => a.action === 'support.organisation.view');
 assert.equal(view.actorId, SUPPORT);
 assert.equal(view.targetId, ORG);
 assert.deepEqual(view.detail, { view: 'overview', activity_limit: 20 });
 const serialised = JSON.stringify(view);
 for (const value of ['org_acme', 'Acme', 'manager', 'usr_admin_1', '2027-01-01']) assert.ok(!serialised.includes(value), value);
});

test('audit: a lookup is recorded against the matched organisation, and an unmatched lookup records nothing', async () => {
 const h = harness();
 const hit = await call(h.handler, 'GET', '/v1/support/organisations?logto_organisation_id=org_acme', { token: token(SUPPORT) });
 assert.equal(hit.status, 200);
 assert.deepEqual(hit.body, { organisationId: ORG });
 assert.deepEqual(h.store.audits.map((a) => [a.action, a.outcome, a.targetId, a.detail]), [['support.organisation.lookup', 'success', ORG, { view: 'lookup' }]]);
 const miss = await call(h.handler, 'GET', '/v1/support/organisations?logto_organisation_id=org_nobody', { token: token(SUPPORT) });
 assert.equal(miss.status, 404);
 assert.equal(h.store.audits.length, 1);
 assert.ok(h.logs.some((l) => l.event === 'support_lookup_unmatched'));
});

test('audit: when the audit cannot be written, the read is refused and no data is returned', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 h.store.failAudit = true;
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 503);
 assert.equal(r.body.error, 'audit_unavailable');
 assert.equal(h.store.calls.filter(([k]) => k === 'read').length, 0);
 const lookup = await call(h.handler, 'GET', '/v1/support/organisations?logto_organisation_id=org_acme', { token: token(SUPPORT) });
 assert.equal(lookup.status, 503);
 assert.equal(lookup.body.organisationId, undefined);
});

test('audit: the grant itself is recorded, and it is issued only after that record exists', async () => {
 const h = harness();
 const r = await call(h.handler, 'POST', '/v1/support/grants', { token: token(SUPPORT), body: { organisationId: ORG, reason: 'integration_health' } });
 assert.equal(r.status, 201);
 assert.deepEqual(h.store.audits[0].detail, { reason: 'integration_health', ttl_seconds: SUPPORT_GRANT_TTL_SECONDS });
 const failing = harness();
 failing.store.failAudit = true;
 const refused = await call(failing.handler, 'POST', '/v1/support/grants', { token: token(SUPPORT), body: { organisationId: ORG, reason: 'setup_diagnosis' } });
 assert.equal(refused.status, 503);
 assert.equal(refused.body.grant, undefined);
});

test('audit: a denied read is recorded when the organisation exists', async () => {
 const h = harness();
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT) });
 assert.equal(r.status, 403);
 const denial = h.store.audits.find((a) => a.outcome === 'denied');
 assert.deepEqual(denial.detail, { reason: 'grant_missing' });
 assert.equal(denial.targetId, ORG);
});

// ---------- grant issuance ----------

test('grant: the issued grant verifies for its subject and organisation and expires on schedule', async () => {
 const h = harness();
 const r = await call(h.handler, 'POST', '/v1/support/grants', { token: token(SUPPORT), body: { organisationId: ORG, reason: 'setup_diagnosis' } });
 assert.equal(r.status, 201);
 assert.equal(r.body.scope, 'support:read');
 assert.equal(r.body.expiresAt, new Date(NOW_MS + SUPPORT_GRANT_TTL_SECONDS * 1000).toISOString());
 const args = { key: KEY, token: r.body.grant, subject: SUPPORT, organisationId: ORG };
 assert.equal(verifySupportGrant({ ...args, nowSeconds: NOW_S }).ok, true);
 assert.equal(verifySupportGrant({ ...args, nowSeconds: NOW_S + SUPPORT_GRANT_TTL_SECONDS }).reason, 'expired');
});

test('grant: unknown organisations, unknown reasons and unsupported bodies are refused', async () => {
 const h = harness();
 assert.equal((await call(h.handler, 'POST', '/v1/support/grants', { token: token(SUPPORT), body: { organisationId: '66666666-6666-4666-8666-666666666666', reason: 'setup_diagnosis' } })).status, 404);
 assert.equal((await call(h.handler, 'POST', '/v1/support/grants', { token: token(SUPPORT), body: { organisationId: ORG, reason: 'curiosity' } })).status, 400);
 assert.equal((await call(h.handler, 'POST', '/v1/support/grants', { token: token(SUPPORT), body: { organisationId: ORG, reason: 'setup_diagnosis' }, contentType: 'text/plain' })).status, 415);
 assert.equal(h.store.audits.length, 0);
});

// ---------- tenant scope ----------

test('tenant scope: the response names only the requested organisation', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 const body = JSON.stringify(r.body);
 assert.ok(!body.includes(OTHER) && !body.includes('org_other'));
 assert.equal(h.store.calls.filter(([k]) => k === 'read').every(([, id]) => id === ORG), true);
});

test('tenant scope: a snapshot for another organisation is refused, not returned', async () => {
 const store = fakeStore();
 store.readOverride = () => centralFor(OTHER);
 const h = harness({ store });
 const grant = await issueGrant(h);
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 503);
 assert.equal(r.body.organisation, undefined);
 assert.ok(!JSON.stringify(r.body).includes(OTHER));
 assert.ok(h.logs.some((l) => l.event === 'support_read_scope_violation'));
});

test('tenant scope: a read failure returns a generic 503 without database detail', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 h.store.failRead = true;
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 503);
 assert.deepEqual(r.body, { error: 'central_unavailable' });
});

// ---------- degraded product view ----------

test('degraded: product outages degrade the product sections, keep Central data, and still return 200', async () => {
 const productStatus = async (productId) => {
  if (productId === 'sorted') throw new Error('ECONNREFUSED to internal host');
  if (productId === 'supercharged') return new Promise(() => {});
  return { status: 'ok', checkedAt: '2026-11-09T09:59:00.000Z', secret: 'leaked-value', internalUrl: 'https://x.internal' };
 };
 const h = harness({ productStatus });
 const grant = await issueGrant(h);
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 200);
 assert.equal(r.body.memberships.active, 2);
 assert.equal(r.body.products[0].entitlement.status, 'active');
 assert.deepEqual(r.body.products[0].health, { freshness: 'unavailable', reason: 'product_unreachable' });
 assert.deepEqual(r.body.products[1].health, { freshness: 'unavailable', reason: 'timeout' });
 assert.deepEqual(r.body.products[2].health, { freshness: 'live', status: 'ok', checkedAt: '2026-11-09T09:59:00.000Z' });
 const json = JSON.stringify(r.body);
 assert.ok(!json.includes('leaked-value') && !json.includes('internal') && !json.includes('ECONNREFUSED'), 'no product detail leaks');
 assert.equal(r.body.degraded, true);
 assert.equal(r.body.sources.productHealth.freshness, 'partial');
});

test('degraded: an invalid product answer is unavailable, and provisioning is always unavailable here', async () => {
 const h = harness({ productStatus: async () => ({ status: 'weird' }) });
 const grant = await issueGrant(h);
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.ok(r.body.products.every((p) => p.health.reason === 'invalid_response'));
 assert.ok(r.body.products.every((p) => p.provisioning.freshness === 'unavailable' && p.provisioning.reason === 'not_integrated'));
 assert.deepEqual(r.body.sources.productProvisioning, { freshness: 'unavailable', reason: 'not_integrated' });
 assert.equal(r.body.sources.productHealth.freshness, 'unavailable');
});

test('degraded: with no product integration at all, the view says so and is not presented as live', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 const r = await call(h.handler, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(r.status, 200);
 assert.ok(r.body.products.every((p) => p.health.reason === 'not_integrated'));
 assert.equal(r.body.sources.central.freshness, 'live');
 assert.equal(r.body.degraded, true);
});

// ---------- composition with the central router ----------

test('routing: the support path is unmounted unless a support handler is injected, and admin stays separate', async () => {
 const h = harness();
 const grant = await issueGrant(h);
 const provisioned = [];
 const admin = createAdminHandler({
  verifyToken: async (t) => ({ logtoSubject: t.replace(/^tok_/, '') }),
  authoriseOperator: async (p) => p.logtoSubject === ADMIN,
  provision: async (...args) => { provisioned.push(args); return 'created'; },
  origins: ORIGINS,
 });
 const base = {
  pool: {}, verifyToken: async (t) => ({ logtoSubject: t.replace(/^tok_/, ''), issuer: 'https://issuer.example.test', audience: 'aud-field', verifiedAt: new Date(NOW_MS).toISOString() }),
  issuer: 'https://issuer.example.test', audiences: { field: 'aud-field', desk: 'aud-desk', academy: 'aud-academy' },
  healthQuery: async () => ({ rows: [] }),
 };
 const unmounted = createCentralHandler({ ...base, adminHandler: admin });
 assert.equal((await call(unmounted, 'GET', overviewUrl(), { token: token(SUPPORT) })).status, 404);

 const central = createCentralHandler({ ...base, adminHandler: admin, supportHandler: h.handler });
 const read = await call(central, 'GET', overviewUrl(), { token: token(SUPPORT), grant });
 assert.equal(read.status, 200);

 // A support grant must not open an admin route: admin authority is checked on its own, and this subject lacks it.
 const attempt = await call(central, 'POST', '/v1/admin/provision', { token: token(SUPPORT), grant, body: { requestId: '11111111-1111-4111-8111-111111111111', authorityReference: 'logto-audit:123', command: {} } });
 assert.equal(attempt.status, 403);
 assert.equal((await call(central, 'GET', '/v1/admin/oidc/plans', { token: token(SUPPORT), grant })).status, 403);
 assert.equal(provisioned.length, 0);
});

test('static: the support module imports no provisioning code and contains no write statements', () => {
 const src = readFileSync(new URL('../src/support.mjs', import.meta.url), 'utf8');
 assert.doesNotMatch(src, /from\s+['"][^'"]*provision/);
 assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
});
