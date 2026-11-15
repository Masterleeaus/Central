import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LinkAssertionVerifier } from '../../../packages/control-plane/dist/index.js';
import { createLinkAssertionProofCheck } from '../src/product-link-assertion-check.mjs';
import { createProductAccountLinkWorkflow } from '../src/product-link-workflow.mjs';

// Skilled's canonical fixtures (control-plane copy, Skilled commit 95935bb): one signed token per case,
// the product key and the Central record the valid tokens were signed against.
const FIXTURE_URL = new URL('../../../packages/control-plane/test/fixtures/skilled-link-assertions/canonical-signed.json', import.meta.url);
const canonical = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));
const ORG_UUID = '00000000-0000-4000-8000-0000000000a1';
const IDENTITY_UUID = '00000000-0000-4000-8000-0000000000b2';
const COMMAND_ID = '00000000-0000-4000-8000-0000000000c3';
const actor = { operatorAuthorityVerified: true, logtoSubject: 'operator-1' };
const context = { actorSubject: 'operator-1', requestId: COMMAND_ID, authorityReference: 'operator-review:1' };

function nonceStore() {
  const seen = new Set();
  return {
    seen,
    async consume(productId, nonce) {
      const key = `${productId}:${nonce}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

function verifierWith(nonces = nonceStore()) {
  const verifier = new LinkAssertionVerifier(
    [{ productId: 'lms', keys: [{ kid: canonical.kid, jwk: canonical.jwk, notBefore: canonical.notBefore }] }],
    nonces,
    () => canonical.now,
  );
  return { verifier, nonces };
}

const expectationFor = () => canonical.expectation;
const commandFor = () => ({
  kind: 'link', id: COMMAND_ID, identityId: IDENTITY_UUID, organisationId: ORG_UUID,
  applicationId: canonical.expectation.applicationId, localUserId: canonical.expectation.localUserId,
  localAccountId: canonical.expectation.localAccountId, verifiedAt: canonical.now,
});
const resolveExpectation = () => async ({ identityId, organisationId }) =>
  identityId === IDENTITY_UUID && organisationId === ORG_UUID
    ? { logtoSubject: canonical.expectation.logtoSubject, logtoOrganisationId: canonical.expectation.logtoOrganisationId }
    : null;

const accepted = canonical.cases.filter((c) => c.expected === 'accept');
const rejected = canonical.cases.filter((c) => c.expected !== 'accept');

test('fixture set is the Skilled set: 26 cases with a key and expectation', () => {
  assert.equal(canonical.cases.length, 26);
  assert.equal(canonical.productId, 'lms');
  assert.equal(canonical.expectation.applicationId, 'academy');
});

for (const c of accepted) {
  test(`check accepts Skilled ${c.name} without spending its nonce`, async () => {
    const { verifier, nonces } = verifierWith();
    const check = createLinkAssertionProofCheck({ verifier, resolveExpectation: resolveExpectation() });
    assert.equal(await check.verify({ proof: c.token, command: commandFor() }), true);
    assert.equal(nonces.seen.size, 0, 'check must not consume the nonce');
    // The write path still spends it, exactly once.
    await verifier.verify(c.token, expectationFor(c));
    await assert.rejects(verifier.verify(c.token, expectationFor(c)), /replayed/);
  });
}

for (const c of rejected) {
  test(`check refuses Skilled ${c.name} with no value returned (${c.expected})`, async () => {
    const { verifier, nonces } = verifierWith();
    await assert.rejects(verifier.check(c.token, expectationFor(c)), (e) => e.code === c.expected);
    const check = createLinkAssertionProofCheck({ verifier, resolveExpectation: resolveExpectation() });
    assert.equal(await check.verify({ proof: c.token, command: commandFor() }), false);
    assert.equal(nonces.seen.size, 0);
  });
}

test('an accepted token for one application is refused when the command names another', async () => {
  const c = accepted[0];
  const { verifier } = verifierWith();
  const check = createLinkAssertionProofCheck({ verifier, resolveExpectation: resolveExpectation() });
  assert.equal(await check.verify({ proof: c.token, command: { ...commandFor(), applicationId: 'field' } }), false);
});

test('an unknown Central identity or organisation fails closed', async () => {
  const c = accepted[0];
  const { verifier } = verifierWith();
  const check = createLinkAssertionProofCheck({ verifier, resolveExpectation: async () => null });
  assert.equal(await check.verify({ proof: c.token, command: commandFor() }), false);
});

test('the adapter requires a verifier with check and a resolver', () => {
  assert.throws(() => createLinkAssertionProofCheck({}), TypeError);
  assert.throws(() => createLinkAssertionProofCheck({ verifier: { check() {} } }), TypeError);
});

test('workflow: a Skilled assertion links once; the replayed token is refused before any second write', async () => {
  const c = accepted[0];
  const { verifier } = verifierWith();
  const writes = [];
  // Stands in for TrustedProvisioningService: it verifies the assertion the way verifyLinkCommand does.
  const trustedProvisioning = {
    async apply(_a, _c, cmd) {
      await verifier.verify(cmd.assertion, expectationFor(c));
      writes.push(cmd);
      return 'created';
    },
  };
  const workflow = createProductAccountLinkWorkflow({
    trustedProvisioning,
    proofVerifier: createLinkAssertionProofCheck({ verifier, resolveExpectation: resolveExpectation() }),
    authoriseLink: async () => true,
    authoriseUnlink: async () => true,
    resolveLink: async () => null,
  });
  assert.equal(await workflow.link(actor, context, commandFor(), c.token), 'created');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].assertion, c.token);
  await assert.rejects(
    workflow.link(actor, { ...context, requestId: COMMAND_ID }, commandFor(), c.token),
    /replayed/,
  );
  assert.equal(writes.length, 1);
});

test('workflow: a rejected Skilled assertion never reaches the write', async () => {
  const c = rejected.find((r) => r.expected === 'wrong_user' || r.expected === 'account_mismatch') ?? rejected[0];
  const { verifier } = verifierWith();
  let wrote = false;
  const workflow = createProductAccountLinkWorkflow({
    trustedProvisioning: { async apply() { wrote = true; return 'created'; } },
    proofVerifier: createLinkAssertionProofCheck({ verifier, resolveExpectation: resolveExpectation() }),
    authoriseLink: async () => true,
    authoriseUnlink: async () => true,
    resolveLink: async () => null,
  });
  await assert.rejects(workflow.link(actor, context, commandFor(), c.token), /product account control not proven/);
  assert.equal(wrote, false);
});
