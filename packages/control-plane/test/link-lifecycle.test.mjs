/** Link create, review, relink and unlink through CentralProvisioner. SQL is matched by shape here;
 * the same statements are executed against PostgreSQL 16 in the migration verification (see docs/LINKING.md). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CentralProvisioner, LinkReviewRequired } from '../dist/provisioning.js';
import { LOCAL_ACCOUNT } from './support/link-signing.mjs';

const ORG = '33333333-3333-4333-8333-333333333333', ORG_B = '55555555-5555-4555-8555-555555555555';
const IDENT = '44444444-4444-4444-8444-444444444444', LINK = '66666666-6666-4666-8666-666666666666';
const OTHER_IDENT = '77777777-7777-4777-8777-777777777777';
const reqId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx = (n) => ({ requestId: reqId(n), actorSubject: 'operator_1', authorityReference: 'policy:1' });
const TOKEN = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c3JfeHl6In0.c2lnbmF0dXJl';
const isBump = (q) => q.startsWith('INSERT INTO titan.titan_session_revocations');

/** Routes each statement to a canned result and records every call in order. */
function fakeDb({ same = [], claimed = [], insertRowCount = 1, lock = null, updateRowCount = 1, updateError = null, audit = [] } = {}) {
  const calls = []; let released = 0;
  const route = (q) => {
    if (q.startsWith('SELECT command_kind')) return { rows: audit };
    if (q.includes('FROM titan.local_account_links WHERE identity_id=$1')) return { rows: same };
    if (q.includes("WHERE application_id=$1 AND local_account_id=$2 AND state='verified'")) return { rows: claimed };
    if (q.startsWith('INSERT INTO titan.local_account_links')) return { rowCount: insertRowCount, rows: insertRowCount ? [{ id: LINK }] : [] };
    if (q.includes('FROM titan.local_account_links l JOIN')) return { rows: lock ? [lock] : [] };
    if (q.startsWith('UPDATE titan.local_account_links')) { if (updateError) throw updateError; return { rowCount: updateRowCount, rows: [] }; }
    if (q.startsWith('INSERT INTO titan.link_reviews')) return { rowCount: 1, rows: [{ id: '88888888-8888-4888-8888-888888888888' }] };
    if (isBump(q)) return { rows: [{ generation: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  };
  const pool = { calls, get released() { return released; }, async connect() { return { async query(q, p) { calls.push([q, p]); return route(q, p); }, release() { released++; } }; } };
  return pool;
}
const has = (pool, pred) => pool.calls.some(([q]) => pred(q));
const linkCreate = (over = {}) => ({ kind: 'link', id: LINK, identityId: IDENT, organisationId: ORG, applicationId: 'field', localUserId: 'user-0001-abcd', localAccountId: LOCAL_ACCOUNT, assertion: TOKEN, ...over });
const relink = (over = {}) => ({ kind: 'link_relink', id: LINK, identityId: IDENT, organisationId: ORG, applicationId: 'field', expectedRevision: 1, localUserId: 'user-0002-abcd', localAccountId: 'acct-0002-abcd', assertion: TOKEN, ...over });
const lockRow = (over = {}) => ({ identity_id: IDENT, organisation_id: ORG, application_id: 'field', local_account_id: LOCAL_ACCOUNT, state: 'verified', revision: 1, logto_subject: 'usr_abcdef12', ...over });

test('link create writes a verified row with the database clock, then commits and audits once', async () => {
  const pool = fakeDb();
  assert.equal(await new CentralProvisioner(pool).apply(ctx(1), linkCreate()), 'created');
  const insert = pool.calls.find(([q]) => q.startsWith('INSERT INTO titan.local_account_links'));
  assert.match(insert[0], /'verified',now\(\)/);
  assert.equal(insert[1].length, 6, 'caller supplies no verification time');
  assert.equal(pool.calls.at(-1)[0], 'COMMIT');
  assert.equal(pool.calls.filter(([q]) => q.startsWith('INSERT INTO titan.provisioning_audit')).length, 1);
});

test('the audit digest stores the assertion hash, never the signed token', async () => {
  const pool = fakeDb();
  await new CentralProvisioner(pool).apply(ctx(2), linkCreate());
  const audit = pool.calls.find(([q]) => q.startsWith('INSERT INTO titan.provisioning_audit'))[1];
  assert.ok(!JSON.stringify(pool.calls).includes(TOKEN));
  assert.match(audit[4], /"assertionSha256":"[0-9a-f]{64}"/);
});

test('reusing a request ID with a different assertion is refused', async () => {
  const first = fakeDb();
  await new CentralProvisioner(first).apply(ctx(3), linkCreate());
  const audit = first.calls.find(([q]) => q.startsWith('INSERT INTO titan.provisioning_audit'))[1];
  const replay = fakeDb({ audit: [{ command_kind: 'link', command_digest: audit[4] }] });
  await assert.rejects(new CentralProvisioner(replay).apply(ctx(3), linkCreate({ assertion: TOKEN.replace('c2ln', 'Y29k') })), /reused/);
  assert.equal(has(replay, q => q.startsWith('INSERT INTO titan.local_account_links')), false);
});

test('existing verified link for the same identity and organisation with another account goes to review, no link write', async () => {
  const pool = fakeDb({ same: [{ state: 'verified', local_account_id: 'acct-other-0009' }] });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(4), linkCreate()), (e) => e instanceof LinkReviewRequired && e.reason === 'existing_link_other_account');
  assert.equal(has(pool, q => q.startsWith('INSERT INTO titan.local_account_links') || q.startsWith('UPDATE titan.local_account_links')), false);
  assert.ok(has(pool, q => q.startsWith('INSERT INTO titan.link_reviews')));
  assert.equal(pool.calls.at(-1)[0], 'COMMIT', 'review commits so the ambiguity is kept');
  assert.equal(pool.calls.some(([q]) => q === 'ROLLBACK'), false);
});

test('a local account already verified for another identity or organisation goes to review', async () => {
  const pool = fakeDb({ claimed: [{ id: LINK }] });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(5), linkCreate({ organisationId: ORG_B })), (e) => e instanceof LinkReviewRequired && e.reason === 'account_claimed_elsewhere');
  assert.equal(has(pool, q => q.startsWith('INSERT INTO titan.local_account_links')), false);
  assert.equal(pool.calls.at(-1)[0], 'COMMIT');
});

test('a concurrent insert that wins the race is recorded for review, not overwritten', async () => {
  const pool = fakeDb({ insertRowCount: 0 });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(6), linkCreate()), (e) => e instanceof LinkReviewRequired && e.reason === 'concurrent_conflict');
  assert.equal(pool.calls.at(-1)[0], 'COMMIT');
});

test('a revoked link for the same tuple is a plain conflict: it needs explicit relink, and no review is recorded', async () => {
  const pool = fakeDb({ same: [{ state: 'revoked', local_account_id: LOCAL_ACCOUNT }] });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(7), linkCreate()), /requires explicit relink or unlink/);
  assert.equal(has(pool, q => q.startsWith('INSERT INTO titan.link_reviews')), false);
  assert.equal(pool.calls.at(-1)[0], 'ROLLBACK');
});

test('relink with a stale expected revision fails closed with no update, bump or audit', async () => {
  const pool = fakeDb({ lock: lockRow({ revision: 3 }) });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(8), relink({ expectedRevision: 2 })), /revision conflict/);
  assert.equal(has(pool, q => q.startsWith('UPDATE') || isBump(q) || q.startsWith('INSERT INTO titan.provisioning_audit')), false);
  assert.equal(pool.calls.at(-1)[0], 'ROLLBACK');
});

test('relink with the current revision updates under a revision guard, revokes the subject sessions, and audits', async () => {
  const pool = fakeDb({ lock: lockRow({ revision: 1 }) });
  assert.equal(await new CentralProvisioner(pool).apply(ctx(9), relink()), 'updated');
  const upd = pool.calls.find(([q]) => q.startsWith('UPDATE titan.local_account_links'));
  assert.match(upd[0], /AND revision=\$2/);
  assert.deepEqual(pool.calls.filter(([q]) => isBump(q)).map(([, p]) => p), [['field', 'usr_abcdef12', ORG]]);
  assert.equal(pool.calls.at(-1)[0], 'COMMIT');
});

test('relink to the account already linked is refused as a no-op', async () => {
  const pool = fakeDb({ lock: lockRow({ revision: 1 }) });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(10), relink({ localAccountId: LOCAL_ACCOUNT })), /current account/);
});

test('relink with a different identity or organisation is refused (cross-tenant)', async () => {
  const otherOrg = fakeDb({ lock: lockRow({ organisation_id: ORG_B }) });
  await assert.rejects(new CentralProvisioner(otherOrg).apply(ctx(11), relink()), /organisation mismatch/);
  const otherIdent = fakeDb({ lock: lockRow({ identity_id: OTHER_IDENT }) });
  await assert.rejects(new CentralProvisioner(otherIdent).apply(ctx(12), relink()), /identity or application mismatch/);
  assert.equal(has(otherOrg, q => q.startsWith('UPDATE titan.local_account_links')), false);
});

test('relink to an account claimed by another row goes to review', async () => {
  const pool = fakeDb({ lock: lockRow({ revision: 1 }), claimed: [{ id: '99999999-9999-4999-8999-999999999999' }] });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(13), relink()), (e) => e instanceof LinkReviewRequired && e.reason === 'account_claimed_elsewhere');
  assert.equal(has(pool, q => q.startsWith('UPDATE titan.local_account_links')), false);
});

test('relink losing the unique-index race is recorded for review', async () => {
  const pool = fakeDb({ lock: lockRow({ revision: 1 }), updateError: Object.assign(new Error('duplicate key'), { code: '23505' }) });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(14), relink()), (e) => e instanceof LinkReviewRequired && e.reason === 'concurrent_conflict');
  assert.ok(has(pool, q => q === 'ROLLBACK TO SAVEPOINT link_write'));
  assert.equal(pool.calls.at(-1)[0], 'COMMIT');
});

test('unlink (link_revoke) with the expected revision bumps only the affected application and subject', async () => {
  const pool = fakeDb({ lock: lockRow({ revision: 2 }) });
  assert.equal(await new CentralProvisioner(pool).apply(ctx(15), { kind: 'link_revoke', id: LINK, organisationId: ORG, expectedRevision: 2 }), 'updated');
  assert.deepEqual(pool.calls.filter(([q]) => isBump(q)).map(([, p]) => p), [['field', 'usr_abcdef12', ORG]]);
  assert.equal(pool.calls.at(-1)[0], 'COMMIT');
});

test('unlink with a stale revision does not revoke and does not change the link', async () => {
  const pool = fakeDb({ lock: lockRow({ revision: 4 }) });
  await assert.rejects(new CentralProvisioner(pool).apply(ctx(16), { kind: 'link_revoke', id: LINK, organisationId: ORG, expectedRevision: 2 }), /revision conflict/);
  assert.equal(has(pool, q => isBump(q) || q.startsWith('UPDATE')), false);
});

test('invalid relink commands never connect', async () => {
  const pool = { async connect() { throw Error('should not connect'); } };
  const p = new CentralProvisioner(pool);
  await assert.rejects(p.apply(ctx(17), relink({ expectedRevision: 0 })), /invalid/);
  await assert.rejects(p.apply(ctx(18), relink({ assertion: 'two.parts' })), /invalid/);
  await assert.rejects(p.apply(ctx(19), relink({ localUserId: ' ' })), /invalid/);
});
