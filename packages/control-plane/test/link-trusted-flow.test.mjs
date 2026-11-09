/** The real verifier behind TrustedProvisioningService: what reaches the provisioner, and what never does. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TrustedProvisioningService, LinkAssertionVerifier, verifyLinkCommand, LinkReviewRequired } from '../dist/index.js';
import { makeProductKey, claimsFor, signClaims, memoryNonces, NOW, NOW_S, SUBJECT, ORG_A_LOGTO, ORG_B_LOGTO, LOCAL_USER, LOCAL_ACCOUNT } from './support/link-signing.mjs';

const sorted = makeProductKey('sorted-2026-01');
const supercharged = makeProductKey('supercharged-2026-01');
const IDENT = '44444444-4444-4444-8444-444444444444', ORG_A = '33333333-3333-4333-8333-333333333333', ORG_B = '55555555-5555-4555-8555-555555555555';
const LINK = '66666666-6666-4666-8666-666666666666';
const ctx = (n) => ({ requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, actorSubject: 'operator_1', authorityReference: 'policy:1' });
const actor = { logtoSubject: 'operator_1', operatorAuthorityVerified: true };

function harness({ nonces = memoryNonces(), throws = null } = {}) {
 const written = [];
 const provisioner = { apply: async (c, command) => { written.push(command); if (throws) throw throws; return 'created'; } };
 const verifier = new LinkAssertionVerifier([{ productId: 'sorted', keys: [sorted.keyConfig] }, { productId: 'supercharged', keys: [supercharged.keyConfig] }], nonces, () => NOW);
 const resolve = async (type, id) => (type === 'identity' ? (id === IDENT ? SUBJECT : undefined) : id === ORG_A ? ORG_A_LOGTO : id === ORG_B ? ORG_B_LOGTO : undefined);
 const logto = { assertIdentity: async () => {}, assertOrganisation: async () => {}, assertMembership: async () => {} };
 const svc = new TrustedProvisioningService(provisioner, logto, async () => true, resolve, verifyLinkCommand(verifier));
 return { svc, written, nonces };
}
const cmd = (token, over = {}) => ({ kind: 'link', id: LINK, identityId: IDENT, organisationId: ORG_A, applicationId: 'field', localUserId: LOCAL_USER, localAccountId: LOCAL_ACCOUNT, assertion: token, ...over });
const rejects = (p, re) => assert.rejects(p, re);

test('a valid Sorted assertion for a Field (legacy id) link reaches the provisioner once', async () => {
 const { svc, written } = harness();
 assert.equal(await svc.apply(actor, ctx(1), cmd(signClaims(sorted, claimsFor()))), 'created');
 assert.equal(written.length, 1);
});

test('the same signed assertion cannot be used twice', async () => {
 const { svc, written } = harness();
 const token = signClaims(sorted, claimsFor());
 await svc.apply(actor, ctx(2), cmd(token));
 await rejects(svc.apply(actor, ctx(3), cmd(token)), /replayed/);
 assert.equal(written.length, 1);
});

test('cross-tenant: an assertion for organisation B cannot link an account into organisation A', async () => {
 const { svc, written } = harness();
 await rejects(svc.apply(actor, ctx(4), cmd(signClaims(sorted, claimsFor({ org: ORG_B_LOGTO })))), /organisation_mismatch/);
 assert.equal(written.length, 0);
});

test('an email-only assertion never reaches the provisioner', async () => {
 const { svc, written } = harness();
 const emailOnly = signClaims(sorted, { iss: 'sorted', aud: 'titan-central', email: 'jane@example.com', nonce: claimsFor().nonce, iat: NOW_S, exp: NOW_S + 60 });
 await rejects(svc.apply(actor, ctx(5), cmd(emailOnly)), /forbidden_claim/);
 assert.equal(written.length, 0);
});

test('a Supercharged (Desk) signed assertion cannot link a Field account', async () => {
 const { svc, written } = harness();
 await rejects(svc.apply(actor, ctx(6), cmd(signClaims(supercharged, claimsFor({ iss: 'supercharged' })))), /product_mismatch/);
 assert.equal(written.length, 0);
});

test('an assertion bound to a different local account is rejected before any write', async () => {
 const { svc, written } = harness();
 await rejects(svc.apply(actor, ctx(7), cmd(signClaims(sorted, claimsFor()), { localAccountId: 'acct-other-0009' })), /account_mismatch/);
 assert.equal(written.length, 0);
});

test('a rejected assertion does not spend its nonce, so the product can still use the same assertion', async () => {
 const { svc, written } = harness();
 const token = signClaims(sorted, claimsFor());
 await rejects(svc.apply(actor, ctx(8), cmd(token, { localAccountId: 'acct-other-0009' })), /account_mismatch/);
 assert.equal(await svc.apply(actor, ctx(9), cmd(token)), 'created');
 assert.equal(written.length, 1);
});

test('an expired assertion never reaches the provisioner', async () => {
 const { svc, written } = harness();
 await rejects(svc.apply(actor, ctx(10), cmd(signClaims(sorted, claimsFor({ iat: NOW_S - 200, exp: NOW_S - 80 })))), /expired/);
 assert.equal(written.length, 0);
});

test('a review outcome from the provisioner surfaces to the caller as LinkReviewRequired', async () => {
 const { svc } = harness({ throws: new LinkReviewRequired('existing_link_other_account', 'r1') });
 await rejects(svc.apply(actor, ctx(11), cmd(signClaims(sorted, claimsFor()))), (e) => e instanceof LinkReviewRequired && e.reason === 'existing_link_other_account');
});

test('relink must carry a fresh assertion too; the stored command never holds a token for the audit', async () => {
 const { svc, written } = harness();
 const relinkCmd = { kind: 'link_relink', id: LINK, identityId: IDENT, organisationId: ORG_A, applicationId: 'field', expectedRevision: 1, localUserId: LOCAL_USER, localAccountId: LOCAL_ACCOUNT, assertion: signClaims(sorted, claimsFor()) };
 assert.equal(await svc.apply(actor, ctx(12), relinkCmd), 'created');
 assert.equal(written[0].kind, 'link_relink');
});

test('unlink needs no assertion and still requires canonical organisation resolution', async () => {
 const { svc, written } = harness();
 await rejects(svc.apply(actor, ctx(13), { kind: 'link_revoke', id: LINK, organisationId: '99999999-9999-4999-8999-999999999999', expectedRevision: 1 }), /unverified organisation/);
 assert.equal(written.length, 0);
});
