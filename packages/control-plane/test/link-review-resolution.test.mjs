/** Reviewed resolution of link_reviews rows (issue #37) through CentralProvisioner and TrustedProvisioningService.
 * The fake store executes only the statements the provisioner issues; any other SQL fails the test. The same
 * statements run against PostgreSQL 16 in the migration verification (docs/LINKING.md). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CentralProvisioner } from '../dist/provisioning.js';
import { TrustedProvisioningService } from '../dist/trusted-provisioning.js';

const ORG = '33333333-3333-4333-8333-333333333333';
const ORG_B = '55555555-5555-4555-8555-555555555555';
const IDENT = '44444444-4444-4444-8444-444444444444';
const OTHER_IDENT = '77777777-7777-4777-8777-777777777777';
const REVIEW = '88888888-8888-4888-8888-888888888888';
const LINK = '66666666-6666-4666-8666-666666666666';
const OTHER_LINK = '99999999-9999-4999-8999-999999999999';
const SUBJECT = 'usr_abcdef12';
const TOKEN = 'aGVhZGVy.Y2xhaW1z.c2ln';
const TOKEN_2 = 'aGVhZGVy.Y2xhaW1z.c2lnMg';
const reqId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx = (n) => ({ requestId: reqId(n), actorSubject: 'operator_1', authorityReference: 'policy:review-1' });
const actor = { logtoSubject: 'operator_1', operatorAuthorityVerified: true };

const openReview = (over = {}) => ({ identity_id: IDENT, organisation_id: ORG, application_id: 'field', local_account_id: 'acct-new-0007', state: 'open', resolved_by: null, resolution_reason: null, resolution_request_id: null, ...over });
const link = (over = {}) => ({ id: LINK, identity_id: IDENT, organisation_id: ORG, application_id: 'field', local_user_id: 'user-old-0001', local_account_id: 'acct-old-0001', state: 'verified', revision: 2, ...over });
const approve = (over = {}) => ({ kind: 'link_review_resolve', id: REVIEW, identityId: IDENT, organisationId: ORG, applicationId: 'field', reason: 'Support ticket 123 confirmed the account', decision: 'approved', localUserId: 'user-new-0007', localAccountId: 'acct-new-0007', assertion: TOKEN, ...over });
const reject = (over = {}) => ({ kind: 'link_review_resolve', id: REVIEW, identityId: IDENT, organisationId: ORG, applicationId: 'field', reason: 'Account belongs to someone else', decision: 'rejected', ...over });

/** In-memory tables. Snapshots make ROLLBACK restore them, as a transaction would. */
function fresh({ reviews = { [REVIEW]: openReview() }, links = [] } = {}) {
  return { reviews, links, identities: { [IDENT]: SUBJECT, [OTHER_IDENT]: 'usr_other0002' }, audit: [], bumps: [], commits: 0, rollbacks: 0, connects: 0, snap: null };
}
const snapshot = (s) => structuredClone({ reviews: s.reviews, links: s.links, audit: s.audit, bumps: s.bumps });
function restore(s, snap) { s.reviews = snap.reviews; s.links = snap.links; s.audit = snap.audit; s.bumps = snap.bumps; }

function query(s, sql, p = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q === 'BEGIN') { s.snap = snapshot(s); return { rows: [] }; }
  if (q === 'COMMIT') { s.snap = null; s.commits++; return { rows: [] }; }
  if (q === 'ROLLBACK') { if (s.snap) restore(s, s.snap); s.snap = null; s.rollbacks++; return { rows: [] }; }
  if (q.startsWith('SET ') || q.startsWith('SELECT pg_advisory')) return { rows: [] };
  if (q.startsWith('SELECT command_kind, command_digest FROM titan.provisioning_audit WHERE request_id=$1')) {
    const rows = s.audit.filter((a) => a.request_id === p[0]).map((a) => ({ command_kind: a.command_kind, command_digest: a.command_digest }));
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith('SELECT identity_id, organisation_id, application_id, local_account_id, state FROM titan.link_reviews WHERE id=$1')) {
    const r = s.reviews[p[0]];
    return { rows: r ? [{ ...r }] : [] };
  }
  if (q.startsWith('UPDATE titan.link_reviews SET state=$2')) {
    const r = s.reviews[p[0]];
    if (!r || r.state !== 'open') return { rowCount: 0, rows: [] };
    Object.assign(r, { state: p[1], resolved_by: p[2], resolution_reason: p[3], resolution_request_id: p[4] });
    return { rowCount: 1, rows: [] };
  }
  if (q.includes('FROM titan.local_account_links l JOIN titan.identities i')) {
    const rows = s.links.filter((l) => l.identity_id === p[0] && l.organisation_id === p[1] && l.application_id === p[2])
      .map((l) => ({ id: l.id, state: l.state, local_account_id: l.local_account_id, revision: l.revision, logto_subject: s.identities[l.identity_id] }));
    return { rows };
  }
  if (q.startsWith("SELECT id FROM titan.local_account_links WHERE application_id=$1 AND local_account_id=$2 AND state='verified'")) {
    const rows = s.links.filter((l) => l.application_id === p[0] && l.local_account_id === p[1] && l.state === 'verified' && (p[2] === undefined || l.id !== p[2])).map((l) => ({ id: l.id }));
    return { rows };
  }
  if (q.startsWith('INSERT INTO titan.local_account_links')) {
    const clash = s.links.some((l) => l.application_id === p[3] && l.local_account_id === p[5] && l.state === 'verified');
    if (clash) return { rowCount: 0, rows: [] };
    s.links.push({ id: p[0], identity_id: p[1], organisation_id: p[2], application_id: p[3], local_user_id: p[4], local_account_id: p[5], state: 'verified', revision: 1 });
    return { rowCount: 1, rows: [{ id: p[0] }] };
  }
  if (q.startsWith('UPDATE titan.local_account_links SET local_user_id=$3')) {
    const l = s.links.find((x) => x.id === p[0]);
    if (!l || l.revision !== p[1]) return { rowCount: 0, rows: [] };
    Object.assign(l, { local_user_id: p[2], local_account_id: p[3], state: 'verified', revision: l.revision + 1 });
    return { rowCount: 1, rows: [] };
  }
  if (q.startsWith('INSERT INTO titan.titan_session_revocations')) { s.bumps.push(p); return { rows: [{ generation: 1 }], rowCount: 1 }; }
  if (q.startsWith('INSERT INTO titan.provisioning_audit')) {
    s.audit.push({ request_id: p[0], actor_subject: p[1], authority_reference: p[2], command_kind: p[3], command_digest: p[4], subject_id: p[5], reason: p[6] ?? null });
    return { rowCount: 1, rows: [] };
  }
  throw new Error(`unexpected SQL in fake: ${q}`);
}
function makePool(s) {
  return { connect: async () => { s.connects++; return { query: async (sql, p) => query(s, sql, p), release() {} }; } };
}
const provisioner = (s) => new CentralProvisioner(makePool(s));

/** The trusted service with a fake Logto check and a fake assertion verifier that records each call. */
const canonical = async (type, uuid) => (type === 'identity' ? (uuid === IDENT ? SUBJECT : undefined) : (uuid === ORG ? 'org_tenanta01' : undefined));
function trusted(s, { authorize = async () => true, verify = async () => true, resolve = canonical } = {}) {
  const calls = { verify: [], membership: [] };
  const logto = { assertIdentity: async () => {}, assertOrganisation: async () => {}, assertMembership: async (u, o) => { calls.membership.push([u, o]); } };
  const verifyLocalLink = async (input) => { calls.verify.push(input.command.assertion); return verify(input); };
  const svc = new TrustedProvisioningService(provisioner(s), logto, async (a, c) => authorize(a, c), resolve, verifyLocalLink);
  return { svc, calls };
}

// ---- approve ----

test('approve creates the link when the identity has none, marks the review approved and audits the reason', async () => {
  const s = fresh();
  assert.equal(await provisioner(s).apply(ctx(1), approve()), 'created');
  assert.equal(s.links.length, 1);
  assert.deepEqual([s.links[0].local_account_id, s.links[0].state, s.links[0].revision], ['acct-new-0007', 'verified', 1]);
  assert.equal(s.reviews[REVIEW].state, 'approved');
  assert.equal(s.reviews[REVIEW].resolved_by, 'operator_1');
  assert.equal(s.reviews[REVIEW].resolution_request_id, reqId(1));
  const row = s.audit.at(-1);
  assert.equal(row.command_kind, 'link_review_resolve');
  assert.equal(row.reason, 'Support ticket 123 confirmed the account');
  assert.equal(row.subject_id, REVIEW);
  assert.equal(s.commits, 1);
  assert.equal(s.bumps.length, 0, 'creating a link revokes nothing');
  assert.ok(!JSON.stringify(s.audit).includes(TOKEN), 'the audit digest never holds the token');
});

test('approve relinks the existing row with a matching expected revision and revokes that application for the subject', async () => {
  const s = fresh({ links: [link({ revision: 2 })] });
  assert.equal(await provisioner(s).apply(ctx(2), approve({ expectedRevision: 2 })), 'updated');
  assert.equal(s.links[0].local_account_id, 'acct-new-0007');
  assert.equal(s.links[0].revision, 3);
  assert.deepEqual(s.bumps.map((p) => [p[0], p[1], p[2]]), [['field', SUBJECT, ORG]]);
  assert.equal(s.reviews[REVIEW].state, 'approved');
});

test('approve for a link that exists but has no expected revision fails closed', async () => {
  const s = fresh({ links: [link()] });
  await assert.rejects(provisioner(s).apply(ctx(3), approve()), /revision conflict/);
  assert.equal(s.reviews[REVIEW].state, 'open');
  assert.equal(s.links[0].local_account_id, 'acct-old-0001');
  assert.equal(s.audit.length, 0);
});

test('approve with a stale expected revision fails closed: no link change, review stays open, nothing audited', async () => {
  const s = fresh({ links: [link({ revision: 2 })] });
  await assert.rejects(provisioner(s).apply(ctx(4), approve({ expectedRevision: 1 })), /revision conflict/);
  assert.equal(s.links[0].local_account_id, 'acct-old-0001');
  assert.equal(s.links[0].revision, 2);
  assert.equal(s.reviews[REVIEW].state, 'open');
  assert.equal(s.bumps.length, 0);
  assert.equal(s.audit.length, 0);
  assert.equal(s.rollbacks, 1);
});

test('approve refuses a local account that is still verified for another link, and leaves the review open', async () => {
  const s = fresh({ links: [link({ id: OTHER_LINK, identity_id: OTHER_IDENT, local_account_id: 'acct-new-0007' })] });
  await assert.rejects(provisioner(s).apply(ctx(5), approve()), /still verified for another link/);
  assert.equal(s.reviews[REVIEW].state, 'open');
  assert.equal(s.links.length, 1);
});

test('approve for an account that is already the linked account is refused, not silently accepted', async () => {
  const s = fresh({ links: [link({ local_account_id: 'acct-new-0007', revision: 4 })] });
  await assert.rejects(provisioner(s).apply(ctx(6), approve({ expectedRevision: 4 })), /current account/);
  assert.equal(s.reviews[REVIEW].state, 'open');
});

// ---- reject ----

test('reject records the decision and creates nothing; the existing link is untouched', async () => {
  const s = fresh({ links: [link()] });
  assert.equal(await provisioner(s).apply(ctx(7), reject()), 'updated');
  assert.equal(s.reviews[REVIEW].state, 'rejected');
  assert.equal(s.reviews[REVIEW].resolution_reason, 'Account belongs to someone else');
  assert.equal(s.reviews[REVIEW].resolved_by, 'operator_1');
  assert.equal(s.links.length, 1);
  assert.deepEqual([s.links[0].local_account_id, s.links[0].revision], ['acct-old-0001', 2]);
  assert.equal(s.bumps.length, 0);
  assert.equal(s.audit.at(-1).command_kind, 'link_review_resolve');
  assert.equal(s.audit.at(-1).reason, 'Account belongs to someone else');
});

test('reject creates no link even when the identity has none and the account is free', async () => {
  const s = fresh();
  await provisioner(s).apply(ctx(8), reject());
  assert.equal(s.links.length, 0);
});

// ---- idempotent resolve ----

test('resolving an approved review again with the same decision is idempotent: replayed, no write, attempt audited', async () => {
  const s = fresh({ links: [link()] });
  await provisioner(s).apply(ctx(9), approve({ expectedRevision: 2 }));
  const before = snapshot(s);
  assert.equal(await provisioner(s).apply(ctx(10), approve({ expectedRevision: 2 })), 'replayed');
  assert.deepEqual(s.links, before.links);
  assert.deepEqual(s.reviews, before.reviews, 'resolution metadata keeps the first resolver');
  assert.equal(s.reviews[REVIEW].resolution_request_id, reqId(9));
  assert.equal(s.bumps.length, 1, 'no second session revocation');
  assert.equal(s.audit.length, 2, 'the replayed attempt is audited under its own request ID');
});

test('resolving a rejected review again with the same decision is idempotent', async () => {
  const s = fresh();
  await provisioner(s).apply(ctx(11), reject());
  assert.equal(await provisioner(s).apply(ctx(12), reject()), 'replayed');
  assert.equal(s.reviews[REVIEW].resolution_request_id, reqId(11));
});

test('a resolved review cannot change decision: approve after reject and reject after approve both fail', async () => {
  const s = fresh();
  await provisioner(s).apply(ctx(13), reject());
  await assert.rejects(provisioner(s).apply(ctx(14), approve()), /different decision/);
  const t = fresh();
  await provisioner(t).apply(ctx(15), approve());
  await assert.rejects(provisioner(t).apply(ctx(16), reject()), /different decision/);
  assert.equal(t.reviews[REVIEW].state, 'approved');
});

test('an approval replay that names a different local account is refused, even though the review is resolved', async () => {
  const s = fresh();
  await provisioner(s).apply(ctx(17), approve());
  await assert.rejects(provisioner(s).apply(ctx(18), approve({ localAccountId: 'acct-other-0009' })), /local account mismatch/);
});

test('wasApplied reports only an exact prior request and refuses a reused ID with another payload', async () => {
  const s = fresh();
  assert.equal(await provisioner(s).wasApplied(ctx(19), approve()), false);
  await provisioner(s).apply(ctx(19), approve());
  assert.equal(await provisioner(s).wasApplied(ctx(19), approve()), true);
  await assert.rejects(provisioner(s).wasApplied(ctx(19), reject()), /reused with different payload/);
});

// ---- refusals that must not write ----

test('a review for another organisation or identity cannot be resolved with the wrong scope', async () => {
  const s = fresh();
  await assert.rejects(provisioner(s).apply(ctx(20), approve({ organisationId: ORG_B })), /identity, organisation or application mismatch/);
  await assert.rejects(provisioner(s).apply(ctx(21), reject({ identityId: OTHER_IDENT })), /identity, organisation or application mismatch/);
  await assert.rejects(provisioner(s).apply(ctx(22), reject({ applicationId: 'desk' })), /identity, organisation or application mismatch/);
  assert.equal(s.reviews[REVIEW].state, 'open');
});

test('an unknown review ID is refused', async () => {
  const s = fresh();
  await assert.rejects(provisioner(s).apply(ctx(23), reject({ id: OTHER_LINK })), /link review not found/);
});

test('approve with a different local account than the review recorded is refused', async () => {
  const s = fresh();
  await assert.rejects(provisioner(s).apply(ctx(24), approve({ localAccountId: 'acct-other-0009' })), /local account mismatch/);
  assert.equal(s.reviews[REVIEW].state, 'open');
});

test('malformed resolutions are refused before any connection is made', async () => {
  const bad = [
    approve({ assertion: 'not-a-jws' }),
    approve({ localUserId: '' }),
    approve({ expectedRevision: 0 }),
    reject({ reason: '' }),
    reject({ reason: 'x'.repeat(501) }),
    reject({ reason: 'line\nbreak' }),
    { ...reject(), decision: 'maybe' },
    reject({ identityId: 'not-a-uuid' }),
  ];
  for (const command of bad) {
    const s = fresh();
    await assert.rejects(provisioner(s).apply(ctx(25), command), /invalid link review resolution/);
    assert.equal(s.connects, 0);
  }
});

// ---- trusted path: authority, assertion, Logto membership ----

test('a non-operator is refused before any write, verification or Logto check', async () => {
  const s = fresh();
  const { svc, calls } = trusted(s, { authorize: async () => false });
  await assert.rejects(svc.apply(actor, ctx(26), approve()), /provisioning forbidden/);
  await assert.rejects(svc.apply(actor, ctx(27), reject()), /provisioning forbidden/);
  assert.equal(s.connects, 0);
  assert.equal(calls.verify.length, 0);
  assert.equal(calls.membership.length, 0);
  assert.equal(s.reviews[REVIEW].state, 'open');
});

test('an approval needs a verified assertion and live membership; a failed verification writes nothing', async () => {
  const s = fresh();
  const { svc, calls } = trusted(s, { verify: async () => false });
  await assert.rejects(svc.apply(actor, ctx(28), approve()), /unverified application account control/);
  assert.equal(calls.membership.length, 1);
  assert.equal(calls.verify.length, 1);
  assert.equal(s.links.length, 0);
  assert.equal(s.reviews[REVIEW].state, 'open');
});

test('a rejection needs neither membership nor an assertion, so a stale operator can still close the review', async () => {
  const s = fresh();
  const { svc, calls } = trusted(s);
  assert.equal(await svc.apply(actor, ctx(29), reject()), 'updated');
  assert.equal(calls.verify.length, 0);
  assert.equal(calls.membership.length, 0);
  assert.equal(s.reviews[REVIEW].state, 'rejected');
});

test('an approval through the trusted path writes once and verifies the assertion once', async () => {
  const s = fresh();
  const { svc, calls } = trusted(s);
  assert.equal(await svc.apply(actor, ctx(30), approve()), 'created');
  assert.deepEqual(calls.verify, [TOKEN]);
  assert.equal(calls.membership.length, 1);
  assert.equal(s.reviews[REVIEW].state, 'approved');
});

test('an identical retry is answered replayed without verifying the spent assertion again', async () => {
  const s = fresh();
  const { svc, calls } = trusted(s);
  await svc.apply(actor, ctx(31), approve());
  assert.equal(await svc.apply(actor, ctx(31), approve()), 'replayed');
  assert.equal(calls.verify.length, 1);
  assert.equal(s.links.length, 1);
});

test('a new request carrying a fresh assertion for an already approved review is idempotent and verifies that assertion', async () => {
  const s = fresh();
  const { svc, calls } = trusted(s);
  await svc.apply(actor, ctx(32), approve());
  assert.equal(await svc.apply(actor, ctx(33), approve({ assertion: TOKEN_2 })), 'replayed');
  assert.deepEqual(calls.verify, [TOKEN, TOKEN_2]);
  assert.equal(s.reviews[REVIEW].resolution_request_id, reqId(32));
});

test('a reused request ID with a different payload is refused before verification', async () => {
  const s = fresh();
  const { svc, calls } = trusted(s);
  await svc.apply(actor, ctx(34), reject());
  await assert.rejects(svc.apply(actor, ctx(34), approve()), /reused with different payload/);
  assert.equal(calls.verify.length, 0);
});

test('an organisation that does not resolve canonically is refused for every decision', async () => {
  const s = fresh();
  const { svc } = trusted(s, { resolve: async (type, uuid) => (type === 'identity' ? SUBJECT : undefined) });
  await assert.rejects(svc.apply(actor, ctx(35), reject()), /unverified organisation/);
  await assert.rejects(svc.apply(actor, ctx(36), approve()), /unverified organisation/);
  assert.equal(s.reviews[REVIEW].state, 'open');
});
