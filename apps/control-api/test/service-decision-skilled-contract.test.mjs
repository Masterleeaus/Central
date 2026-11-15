// Contract test between Central's service-decision endpoint and Skilled's client.
// Fixture values are copied from Skilled's decision transport tests
// (lms-main/apps/backend/src/tests/central-decision-transport.fixture.ts, Skilled HEAD 95935bb).
// skilledAcceptsCurrent() copies Skilled's createAuthenticatedCentralDecisionClient checks at 95935bb
// (central-decision-transport.ts); skilledAcceptsTarget() is the rule Skilled must implement. No live credential and no network beyond loopback is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createSkilledDecisionHandler,SKILLED_DECISION_PATH} from '../src/service-decision-handler.mjs';

// ---- Skilled fixture values (copied) ----
const SKILLED = {
 issuer: 'https://central.example.test',
 subject: 'central-user-0001',
 audience: 'skilled-academy',
 requestId: 'R'.repeat(32),
 bearer: 'server-credential-'.repeat(4),
 // Decision as Central returns it: organisationId is the trusted Logto organisation ID.
 decision: {
  allowed: true, applicationId: 'academy', organisationId: 'central-org-0001',
  localUserId: 'skilled-user-0001', localAccountId: 'account-0001',
  membershipRevision: 1, entitlementRevision: 1, linkRevision: 1,
 },
};
// Central internal organisation UUID that Skilled must send (contract doc: operator-controlled association).
const CENTRAL_ORG_UUID = '00000000-0000-4000-8000-000000000001';

// ---- Skilled acceptance rules ----
// skilledAcceptsCurrent is a copy of Skilled's client at commit 95935bb (central-decision-transport.ts). Its decision
// key set has no expiresAt, so it refuses every Central 200 that carries expiresAt. That is a Skilled-side gap.
// skilledAcceptsTarget is the rule Skilled must implement to match the Central contract (expiresAt required,
// issued-at plus 300 seconds). Both copies are asserted below, so the gap stays visible until Skilled changes.
const SKILLED_ID = /^[A-Za-z0-9:_-]{1,200}$/;
const SKILLED_REQUEST = /^[A-Za-z0-9_-]{32,128}$/;
const EXPIRES_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function exactKeys(value, fields) {
 return Object.keys(value).sort().join('|') === [...fields].sort().join('|');
}
function skilledBoundedDecision(value, fields) {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
 return exactKeys(value, fields) &&
  value.allowed === true && value.applicationId === 'academy' &&
  [value.organisationId, value.localUserId, value.localAccountId].every(v => typeof v === 'string' && SKILLED_ID.test(v)) &&
  [value.membershipRevision, value.entitlementRevision, value.linkRevision].every(v =>
   typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
}
const DECISION_FIELDS = ['allowed', 'applicationId', 'organisationId', 'localUserId', 'localAccountId',
 'membershipRevision', 'entitlementRevision', 'linkRevision'];
const ENVELOPE_FIELDS = ['issuer', 'subject', 'requestId', 'decision'];
/** Skilled's current client (95935bb): no expiresAt in the decision key set. */
function skilledAcceptsCurrent(response, requestBody) {
 if (response.status !== 200) return false;
 if (response.contentType.split(';')[0].trim().toLowerCase() !== 'application/json') return false;
 const env = response.body;
 return !!env && typeof env === 'object' && exactKeys(env, ENVELOPE_FIELDS) &&
  env.issuer === requestBody.issuer && env.subject === requestBody.subject &&
  env.requestId === requestBody.requestId && skilledBoundedDecision(env.decision, DECISION_FIELDS);
}
/** Target rule for Skilled: expiresAt is required on 200 and must lie within 300 seconds of now. */
function skilledAcceptsTarget(response, requestBody) {
 if (response.status !== 200) return false;
 if (response.contentType.split(';')[0].trim().toLowerCase() !== 'application/json') return false;
 const env = response.body;
 const d = env && env.decision;
 if (!d || typeof d !== 'object' || typeof d.expiresAt !== 'string' || !EXPIRES_AT.test(d.expiresAt)) return false;
 const remaining = Date.parse(d.expiresAt) - Date.now();
 return !!env && typeof env === 'object' && exactKeys(env, ENVELOPE_FIELDS) &&
  env.issuer === requestBody.issuer && env.subject === requestBody.subject &&
  env.requestId === requestBody.requestId &&
  skilledBoundedDecision(d, [...DECISION_FIELDS, 'expiresAt']) && remaining > 0 && remaining <= 300_000;
}

// ---- Harness: real handler on loopback, with the Skilled fixture issuer and audience ----
async function callCentral({body, auth = 'Bearer ' + SKILLED.bearer, decide = async () => ({ ...SKILLED.decision }), url = SKILLED_DECISION_PATH} = {}) {
 const handler = createSkilledDecisionHandler({ issuer: SKILLED.issuer, audience: SKILLED.audience, token: SKILLED.bearer, decide });
 const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.statusCode = 404; res.end('not found'); } });
 server.listen(0, '127.0.0.1');
 await once(server, 'listening');
 try {
  const response = await fetch('http://127.0.0.1:' + server.address().port + url, {
   method: 'POST',
   headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json' },
   body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: parsed };
 } finally {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
 }
}

// Request body in the contract shape (contract doc: applicationId, issuer, subject, organisationId, requestId).
const contractBody = (overrides = {}) => ({
 applicationId: 'academy', issuer: SKILLED.issuer, subject: SKILLED.subject,
 organisationId: CENTRAL_ORG_UUID, requestId: SKILLED.requestId, ...overrides,
});

test('Central 200 carries expiresAt; the target Skilled rule accepts it, with a 300 second bound', async () => {
 const body = contractBody();
 const r = await callCentral({ body });
 assert.equal(r.status, 200);
 assert.ok(skilledAcceptsTarget(r, body), JSON.stringify(r));
 const {expiresAt, ...decision} = r.body.decision;
 assert.match(expiresAt, EXPIRES_AT);
 assert.deepEqual(decision, SKILLED.decision);
});

test('gap: Skilled current client refuses Central 200 because of expiresAt (contract doc, section Skilled alignment, item 4)', async () => {
 // Skilled's exactKeys check has no expiresAt, so every real Central allow is refused until Skilled adds it.
 const body = contractBody();
 const r = await callCentral({ body });
 assert.equal(r.status, 200);
 assert.equal(skilledAcceptsCurrent(r, body), false);
 // The same body with expiresAt removed is what Skilled's current client would accept.
 const {expiresAt, ...decision} = r.body.decision;
 assert.equal(skilledAcceptsCurrent({ ...r, body: { ...r.body, decision } }, body), true);
});

test('Skilled acceptance rules reject a response whose requestId or subject does not echo the request', async () => {
 const body = contractBody();
 const r = await callCentral({ body });
 assert.equal(skilledAcceptsTarget({ ...r, body: { ...r.body, requestId: 'Q'.repeat(32) } }, body), false);
 assert.equal(skilledAcceptsTarget({ ...r, body: { ...r.body, subject: 'someone-else' } }, body), false);
 assert.equal(skilledAcceptsCurrent({ ...r, body: { ...r.body, requestId: 'Q'.repeat(32) } }, body), false);
});

test('denied decision answers 403, which Skilled treats as no decision', async () => {
 const r = await callCentral({ body: contractBody(), decide: async () => null });
 assert.equal(r.status, 403);
 assert.equal(skilledAcceptsTarget(r, contractBody()), false);
 assert.equal(skilledAcceptsCurrent(r, contractBody()), false);
});

test('gap: Skilled current request body without organisationId is refused (contract doc, section Skilled alignment)', async () => {
 // Skilled's client (central-decision-transport.ts) sends only applicationId, issuer, subject and requestId.
 // Central requires organisationId, so this request fails until Skilled sends it. Fail-closed, never a guess.
 const skilledCurrentBody = { applicationId: 'academy', issuer: SKILLED.issuer, subject: SKILLED.subject, requestId: SKILLED.requestId };
 let decided = 0;
 const r = await callCentral({ body: skilledCurrentBody, decide: async () => { decided++; return { ...SKILLED.decision }; } });
 assert.equal(r.status, 400);
 assert.deepEqual(r.body, { error: 'invalid_request' });
 assert.equal(decided, 0);
});

test('Skilled bearer fixture is accepted; bearer characters outside the contract charset are refused before any decision', async () => {
 let decided = 0;
 const decide = async () => { decided++; return { ...SKILLED.decision }; };
 assert.equal((await callCentral({ body: contractBody(), decide })).status, 200);
 // Skilled's client does not restrict token characters; Central accepts only [A-Za-z0-9_.-]{32,1024}.
 const plusToken = 'Bearer ' + 'a'.repeat(31) + '+' + 'b'.repeat(8);
 const r = await callCentral({ body: contractBody(), auth: plusToken, decide });
 assert.equal(r.status, 401);
 assert.equal(decided, 1);
});

test('requestId boundary: 32 characters is accepted, 31 is refused', async () => {
 assert.equal((await callCentral({ body: contractBody() })).status, 200);
 const short = await callCentral({ body: contractBody({ requestId: 'R'.repeat(31) }) });
 assert.equal(short.status, 400);
});

test('response content type is application/json, which Skilled requires', async () => {
 const r = await callCentral({ body: contractBody() });
 assert.equal(r.contentType.split(';')[0].trim(), 'application/json');
});

test('wrong path is not the contract endpoint: Skilled fixture endpoint path is refused', async () => {
 // Skilled's fixture endpoint is https://central.example.test/internal/academy/access-decision. Central serves only
 // SKILLED_DECISION_PATH; Skilled's configured endpoint must use that path (contract doc, section Skilled alignment).
 const r = await callCentral({ body: contractBody(), url: '/internal/academy/access-decision' });
 assert.equal(r.status, 404);
});
