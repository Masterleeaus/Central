// Conformance suite: Scheduled's link assertions and signed event envelopes, checked against Central's verifiers.
//
// Fixtures are generated from Scheduled's own code by tools/generate-fixtures.mjs:
//   fixtures/link-assertions.json  Scheduled signer output (scheduled/src/link-assertion.js) plus Scheduled's verdict.
//   fixtures/event-envelopes.json  Envelopes signed and verified by Scheduled's PHP code (SignedEventVerifier.php).
// Each case records the outcome Central should reach once scheduled is registered (centralAfterRegistration) or the
// code Central must throw (centralOutcome).
//
// Link assertions: Scheduled is registered (PRODUCT_IDS, LINK_APPLICATION_TO_PRODUCT, link key config), so every
// link case asserts Central's target outcome directly. The "without a key set" pins check that a verifier holding no
// Scheduled key still rejects with unknown_product.
// Activity events: the source check does not accept scheduled yet (C4 or C5). That case stays an expected-fail
// (node:test `todo`): it runs, and its failure is reported as TODO without failing the suite. When C4 or C5 land,
// remove its todo option.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LinkAssertionVerifier, LinkAssertionRejected } from '../../../packages/control-plane/dist/link-assertion.js';
import { PRODUCT_IDS } from '../../../packages/control-plane/dist/product-registry.js';
import { prepareActivityEvent } from '../../../packages/control-plane/dist/activity-events.js';
import { handleInbound } from '../../../packages/control-plane/dist/outbox-consumer.js';
import { OutboxError } from '../../../packages/control-plane/dist/outbox.js';

const linkFixture = JSON.parse(readFileSync(new URL('./fixtures/link-assertions.json', import.meta.url), 'utf8'));
const eventFixture = JSON.parse(readFileSync(new URL('./fixtures/event-envelopes.json', import.meta.url), 'utf8'));

const NOW_ISO = linkFixture.now;
const NOW_MS = Date.parse(NOW_ISO);
const TODO_ACTIVITY = 'expected-fail until C4 or C5 land: the activity source check does not accept scheduled yet';

// Expectation Central receives for a Scheduled assertion. There is no legacy application id for scheduled, so the
// link application id 'scheduled' maps to the scheduled product through LINK_APPLICATION_TO_PRODUCT.
const SCHEDULED_EXPECTATION = {
  applicationId: 'scheduled',
  logtoSubject: 'central-user-0001',
  logtoOrganisationId: 'central-org-0001',
  localUserId: 'scheduled-user-0001',
  localAccountId: 'scheduled-account-0001',
};

const nonces = () => {
  const seen = new Map();
  return {
    async consume(product, nonce, expiresAt, now) {
      for (const [k, exp] of seen) if (exp <= Date.parse(now)) seen.delete(k);
      const k = `${product}|${nonce}`;
      if (seen.has(k)) return false;
      seen.set(k, Date.parse(expiresAt));
      return true;
    },
  };
};

// A verifier that holds only keys for products Central knows today. Used for the "today" pins.
const currentKeys = generateKeyPairSync('ed25519');
const currentVerifier = () => new LinkAssertionVerifier(
  [{ productId: 'lms', keys: [{ kid: 'lms-current', jwk: { kty: 'OKP', crv: 'Ed25519', x: currentKeys.publicKey.export({ format: 'jwk' }).x }, notBefore: '2026-01-01T00:00:00.000Z' }] }],
  nonces(), () => NOW_ISO,
);

// The verifier once scheduled is registered with the fixture's public key.
const registeredVerifier = () => new LinkAssertionVerifier(
  [{ productId: 'scheduled', keys: [linkFixture.centralKeyConfig] }],
  nonces(), () => NOW_ISO,
);

const linkCase = (id) => {
  const found = linkFixture.cases.find((c) => c.id === id);
  if (!found) throw new Error(`missing link fixture ${id}`);
  return found;
};

test('link fixtures: one case per Scheduled-side scenario, each with Scheduled verdict and Central target', () => {
  const ids = linkFixture.cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(linkFixture.cases.length, 13);
  for (const c of linkFixture.cases) {
    assert.ok(c.token.split('.').length === 3, `${c.id} is a three-segment token`);
    assert.ok(['accept', 'reject'].includes(c.scheduledVerdict.result), `${c.id} has a Scheduled verdict`);
    assert.ok(c.centralAfterRegistration, `${c.id} has a Central target`);
  }
});

test('link fixtures: Scheduled and Central agree on every case except the L-08 clock-skew case', () => {
  const disagreements = linkFixture.cases
    .filter((c) => (c.scheduledVerdict.result === 'accept') !== (c.centralAfterRegistration === 'accept'))
    .map((c) => c.id);
  // L-08: Central allows 30 seconds of future iat, Scheduled allows none. This is the one recorded divergence.
  assert.deepEqual(disagreements, ['L-08']);
});

test('link fixtures: the public key is the only key material; no private key is committed', () => {
  assert.deepEqual(Object.keys(linkFixture.centralKeyConfig.jwk).sort(), ['crv', 'kty', 'x']);
  assert.equal(linkFixture.centralKeyConfig.jwk.kty, 'OKP');
  assert.equal(linkFixture.centralKeyConfig.jwk.crv, 'Ed25519');
  assert.doesNotMatch(JSON.stringify(linkFixture), /"d":/);
});

// Token-shape checks (algorithm, forbidden claims) run before the issuer lookup, so those cases fail on their own
// code even with no Scheduled key set. Every other case stops at the missing key set with unknown_product.
const EARLIER_CHECKS = ['forbidden_claim', 'bad_algorithm'];
for (const c of linkFixture.cases) {
  const expectedCode = EARLIER_CHECKS.includes(c.centralAfterRegistration) ? c.centralAfterRegistration : 'unknown_product';
  test(`link ${c.id} ${c.name}: with no Scheduled key set Central rejects with ${expectedCode}`, async () => {
    await assert.rejects(
      currentVerifier().verify(c.token, SCHEDULED_EXPECTATION),
      (error) => error instanceof LinkAssertionRejected && error.code === expectedCode,
    );
  });
}

test('link: a Scheduled token presented for an LMS expectation is rejected with unknown_product when no Scheduled key set is configured', async () => {
  await assert.rejects(
    currentVerifier().verify(linkCase('L-01').token, {
      applicationId: 'academy', logtoSubject: 'central-user-0001', logtoOrganisationId: 'central-org-0001',
      localUserId: 'scheduled-user-0001', localAccountId: 'scheduled-account-0001',
    }),
    (error) => error instanceof LinkAssertionRejected && error.code === 'unknown_product',
  );
});

test('link: Central accepts a scheduled key set in configuration', () => {
  registeredVerifier();
});

for (const c of linkFixture.cases) {
  test(`link ${c.id} ${c.name}: Central outcome is ${c.centralAfterRegistration}`, async () => {
      const verifier = registeredVerifier();
      if (c.centralAfterRegistration === 'accept') {
        const result = await verifier.verify(c.token, SCHEDULED_EXPECTATION);
        assert.equal(result.productId, 'scheduled');
        return;
      }
      await assert.rejects(
        verifier.verify(c.token, SCHEDULED_EXPECTATION),
        (error) => error instanceof LinkAssertionRejected && error.code === c.centralAfterRegistration,
      );
    });
}

test('product registry: scheduled is listed in PRODUCT_IDS', () => {
  assert.ok(PRODUCT_IDS.includes('scheduled'));
});

test('activity events: source product scheduled is accepted by prepareActivityEvent (expected-fail, C4 or C5)', { todo: TODO_ACTIVITY }, () => {
  assert.doesNotThrow(() => prepareActivityEvent({
    organisationId: '6f1c2a3e-8b4d-4e5f-9a1b-2c3d4e5f6a7b',
    actorKind: 'service',
    actorId: 'scheduled-service',
    action: 'booking.confirmed',
    targetType: 'booking',
    targetId: 'bk-0001',
    sourceProduct: 'scheduled',
    outcome: 'success',
    correlationId: 'corr-scheduled-0001',
  }));
});

// ---------- event envelopes ----------

const eventCase = (id) => {
  const found = eventFixture.cases.find((c) => c.id === id);
  if (!found) throw new Error(`missing event fixture ${id}`);
  return found;
};

const consumer = {
  consumer: eventFixture.consumer.consumer,
  organisationId: eventFixture.consumer.organisationId,
  eventTypes: eventFixture.consumer.eventTypes,
  secret: eventFixture.consumer.secret,
  now: () => Date.parse(eventFixture.now),
};

// Minimal transaction: the processed-events insert returns one row for a new key and none for a duplicate.
const memoryTx = () => {
  const seen = new Set();
  return {
    async query(_text, values) {
      const key = `${values[0]}|${values[1]}`;
      if (seen.has(key)) return { rowCount: 0, rows: [] };
      seen.add(key);
      return { rowCount: 1, rows: [{ consumer: values[0] }] };
    },
  };
};

test('event fixtures: one case per envelope scenario, each with Scheduled verdict and Central outcome', () => {
  const ids = eventFixture.cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(eventFixture.cases.length, 9);
  for (const c of eventFixture.cases) {
    assert.ok(c.scheduledVerdict && typeof c.scheduledVerdict.accepted === 'boolean', `${c.id} has a Scheduled verdict`);
    assert.ok(c.centralOutcome, `${c.id} has a Central outcome`);
  }
});

for (const c of eventFixture.cases) {
  test(`event ${c.id} ${c.name}: Central outcome is ${c.centralOutcome}`, async () => {
    let effects = 0;
    const effect = async () => { effects += 1; };
    const body = c.body;
    if (c.centralOutcome === 'processed') {
      const outcome = await handleInbound(memoryTx(), consumer, body, effect);
      assert.equal(outcome, 'processed');
      assert.equal(effects, 1);
      return;
    }
    await assert.rejects(
      handleInbound(memoryTx(), consumer, body, effect),
      (error) => error instanceof OutboxError && error.code === c.centralOutcome,
    );
    assert.equal(effects, 0, 'a rejected envelope runs no effect');
  });
}

test('event E-01: a redelivered Scheduled envelope is a duplicate and runs no effect', async () => {
  const tx = memoryTx();
  let effects = 0;
  const effect = async () => { effects += 1; };
  assert.equal(await handleInbound(tx, consumer, eventCase('E-01').body, effect), 'processed');
  assert.equal(await handleInbound(tx, consumer, eventCase('E-01').body, effect), 'duplicate');
  assert.equal(effects, 1);
});

test('event fixtures: Scheduled verdicts record signature, freshness and envelope checks as Scheduled applies them', () => {
  assert.equal(eventCase('E-01').scheduledVerdict.accepted, true);
  // Tenant and event-type checks are not verifier checks in Scheduled. The verifier accepts these signed envelopes.
  assert.equal(eventCase('E-04').scheduledVerdict.accepted, true);
  assert.equal(eventCase('E-05').scheduledVerdict.accepted, true);
  assert.equal(eventCase('E-02').scheduledVerdict.reason, 'bad_signature');
  assert.equal(eventCase('E-03').scheduledVerdict.reason, 'bad_signature');
  assert.equal(eventCase('E-06').scheduledVerdict.reason, 'unsigned');
  assert.equal(eventCase('E-07').scheduledVerdict.reason, 'stale');
  assert.equal(eventCase('E-08').scheduledVerdict.reason, 'from_future');
  assert.equal(eventCase('E-09').scheduledVerdict.reason, 'invalid_envelope');
});
