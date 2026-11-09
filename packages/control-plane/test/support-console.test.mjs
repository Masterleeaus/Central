import test from 'node:test';
import assert from 'node:assert/strict';
import { readSupportCentralSnapshot, findOrganisationById, findOrganisationByLogtoId } from '../dist/support-console.js';

const ORG = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-09T10:00:00.000Z');
const WRITE = /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CREATE|ALTER|DROP)\b/i;

const orgRow = (id = ORG, logto = 'org_acme') => ({ id, logto_organisation_id: logto, state: 'active', created_at: new Date('2026-01-01T00:00:00Z') });
const activityRow = (organisationId = ORG) => ({
 event_id: '11111111-1111-4111-8111-111111111111', occurred_at: new Date('2026-11-08T09:00:00Z'), organisation_id: organisationId,
 actor_kind: 'subject', actor_id: 'usr_admin_1', action: 'membership.update', target_type: 'membership', target_id: 'm1',
 source_product: 'central', outcome: 'success', correlation_id: 'corr-0001', detail: { role: 'manager' }, recorded_by: 'titan_trusted_writer',
});

/** Scripted pool. Each statement is matched by a substring; every statement is recorded. */
function scripted(overrides = {}) {
 const calls = [];
 let connects = 0;
 const answers = {
  'FROM titan.organisations WHERE id': [orgRow()],
  'FROM titan.organisations WHERE logto_organisation_id': [orgRow()],
  'FROM titan.memberships': [{ state: 'active', n: 2 }, { state: 'revoked', n: 1 }],
  'FROM titan.entitlements': [
   { organisation_id: ORG, application_id: 'field', state: 'active', expires_at: new Date('2027-01-01T00:00:00Z'), feature_count: 2 },
   { organisation_id: ORG, application_id: 'academy', state: 'active', expires_at: new Date('2026-01-01T00:00:00Z'), feature_count: 0 },
  ],
  'FROM titan.local_account_links': [{ application_id: 'field', state: 'verified', n: 1 }, { application_id: 'academy', state: 'revoked', n: 1 }],
  'FROM titan.activity_events': [activityRow()],
  ...overrides,
 };
 const conn = {
  async query(text, values) {
   calls.push([text, values]);
   if (/^(BEGIN|COMMIT|ROLLBACK|SET )/.test(text.trim()) || text.includes('set_config')) return { rows: [], rowCount: 0 };
   const key = Object.keys(answers).find((k) => text.includes(k));
   const rows = key ? answers[key] : [];
   return { rows: typeof rows === 'function' ? rows(values) : rows, rowCount: rows.length };
  },
  release() {},
 };
 return { calls, get connects() { return connects; }, pool: { async connect() { connects++; return conn; } } };
}

test('snapshot: all statements are reads, run as the trusted reader, scoped to the organisation', async () => {
 const s = scripted();
 const snap = await readSupportCentralSnapshot(s.pool, ORG, { now: NOW, activityLimit: 20 });
 assert.ok(snap);
 const statements = s.calls.map(([t]) => t.trim());
 for (const t of statements) assert.doesNotMatch(t, WRITE, t);
 assert.ok(statements.some((t) => t === 'SET LOCAL ROLE titan_trusted_reader'));
 const scope = s.calls.find(([t]) => t.includes('set_config'));
 assert.deepEqual(scope[1], [ORG], 'organisation bound as a parameter');
 // Every organisation-keyed read carries the organisation as a bound parameter.
 for (const [t, v] of s.calls) {
  if (/FROM titan\.(memberships|entitlements|local_account_links)/.test(t)) assert.deepEqual(v, [ORG], t);
 }
});

test('snapshot: products are mapped from legacy application ids and expiry is computed at read time', async () => {
 const s = scripted();
 const snap = await readSupportCentralSnapshot(s.pool, ORG, { now: NOW, activityLimit: 20 });
 const [sorted, supercharged, lms] = snap.products;
 assert.equal(sorted.productId, 'sorted');
 assert.equal(sorted.applicationId, 'field');
 assert.deepEqual(sorted.entitlement, { status: 'active', expiresAt: '2027-01-01T00:00:00.000Z', expired: false, featureCount: 2 });
 assert.deepEqual(sorted.links, { verified: 1, revoked: 0 });
 assert.equal(supercharged.productId, 'supercharged');
 assert.equal(supercharged.entitlement, null, 'no entitlement row means no entitlement, not an invented one');
 assert.deepEqual(supercharged.links, { verified: 0, revoked: 0 });
 assert.equal(lms.productId, 'lms');
 assert.equal(lms.entitlement.expired, true, 'a past expiry is reported as expired even when the stored state still says active');
 assert.deepEqual(lms.links, { verified: 0, revoked: 1 });
});

test('snapshot: membership counts cover every state, and activity drops the organisation and recorder fields', async () => {
 const s = scripted();
 const snap = await readSupportCentralSnapshot(s.pool, ORG, { now: NOW, activityLimit: 20 });
 assert.deepEqual(snap.memberships, { active: 2, invited: 0, suspended: 0, revoked: 1 });
 assert.equal(snap.readAt, NOW.toISOString());
 const [event] = snap.activity.events;
 assert.equal(event.action, 'membership.update');
 assert.equal('organisationId' in event, false);
 assert.equal('recordedBy' in event, false);
 assert.equal(snap.activity.limit, 20);
});

test('snapshot: an unknown organisation returns undefined, and no activity is read', async () => {
 const s = scripted({ 'FROM titan.organisations WHERE id': [] });
 assert.equal(await readSupportCentralSnapshot(s.pool, ORG, { now: NOW, activityLimit: 20 }), undefined);
 assert.equal(s.calls.some(([t]) => t.includes('titan.activity_events')), false);
});

test('scope: a foreign entitlement row makes the read throw, so no partial data is returned', async () => {
 const s = scripted({ 'FROM titan.entitlements': [{ organisation_id: OTHER, application_id: 'field', state: 'active', expires_at: null, feature_count: 1 }] });
 await assert.rejects(readSupportCentralSnapshot(s.pool, ORG, { now: NOW, activityLimit: 20 }), /scope violation/);
});

test('scope: a foreign organisation row or a foreign activity row makes the read throw', async () => {
 const a = scripted({ 'FROM titan.organisations WHERE id': [orgRow(OTHER)] });
 await assert.rejects(readSupportCentralSnapshot(a.pool, ORG, { now: NOW, activityLimit: 20 }), /scope violation/);
 const b = scripted({ 'FROM titan.activity_events': [activityRow(OTHER)] });
 await assert.rejects(readSupportCentralSnapshot(b.pool, ORG, { now: NOW, activityLimit: 20 }), /scope violation/);
});

test('scope: an unexpected state value from the database is refused', async () => {
 const s = scripted({ 'FROM titan.memberships': [{ state: 'owner-ish', n: 1 }] });
 await assert.rejects(readSupportCentralSnapshot(s.pool, ORG, { now: NOW, activityLimit: 20 }), /unexpected membership state/);
});

test('input: malformed organisation ids, limits and times are refused before any connection', async () => {
 const s = scripted();
 await assert.rejects(readSupportCentralSnapshot(s.pool, 'not-a-uuid', { now: NOW, activityLimit: 20 }));
 await assert.rejects(readSupportCentralSnapshot(s.pool, ORG, { now: NOW, activityLimit: 0 }));
 await assert.rejects(readSupportCentralSnapshot(s.pool, ORG, { now: NOW, activityLimit: 51 }));
 await assert.rejects(readSupportCentralSnapshot(s.pool, ORG, { now: new Date('x'), activityLimit: 20 }));
 await assert.rejects(findOrganisationById(s.pool, 'nope'));
 await assert.rejects(findOrganisationByLogtoId(s.pool, 'has spaces'));
 assert.equal(s.connects, 0);
});

test('lookup: exact match by Central id and by Logto id; ambiguity is an error; no match is undefined', async () => {
 const s = scripted();
 const byId = await findOrganisationById(s.pool, ORG);
 assert.deepEqual(byId, { id: ORG, logtoOrganisationId: 'org_acme', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' });
 const byLogto = await findOrganisationByLogtoId(s.pool, 'org_acme');
 assert.equal(byLogto.id, ORG);
 const none = scripted({ 'FROM titan.organisations WHERE logto_organisation_id': [] });
 assert.equal(await findOrganisationByLogtoId(none.pool, 'org_missing'), undefined);
 const twice = scripted({ 'FROM titan.organisations WHERE logto_organisation_id': [orgRow(), orgRow(OTHER, 'org_acme')] });
 await assert.rejects(findOrganisationByLogtoId(twice.pool, 'org_acme'), /ambiguous/);
 for (const [t] of [...s.calls, ...none.calls]) assert.doesNotMatch(t, WRITE);
});
