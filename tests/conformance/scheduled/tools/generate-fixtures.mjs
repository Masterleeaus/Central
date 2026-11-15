// Test-only fixture generator for the Scheduled <-> Central conformance suite (work package X1).
//
// Usage: node tests/conformance/scheduled/tools/generate-fixtures.mjs <path to the scheduled repository checkout>
//
// Link assertions come from Scheduled's own signer and verifier (scheduled/src/link-assertion.js). Event signatures
// and verdicts come from Scheduled's own PHP code (core/app/Central/Events/SignedEventVerifier.php), run through
// scheduled-event-verifier.php. Keys and secrets are deterministic test-only labels. They are not credentials and
// are not used outside this suite. The private key is never written to disk.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scheduledRoot = path.resolve(process.argv[2] ?? '');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', 'fixtures');
const linkSource = path.join(scheduledRoot, 'scheduled/src/link-assertion.js');
const centralPhpDir = path.join(scheduledRoot, 'core/app/Central');

const { signLinkAssertion, verifyLinkAssertion, publicJwk } = await import(pathToFileURL(linkSource).href);

// ---------- link assertions ----------

const NOW_ISO = '2026-11-15T10:00:00.000Z';
const NOW_S = Math.floor(Date.parse(NOW_ISO) / 1000);
const KID = 'scheduled-conformance-2026';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const keyFromLabel = (label) => createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_PREFIX, createHash('sha256').update(label).digest()]),
  format: 'der',
  type: 'pkcs8',
});
const privateKey = keyFromLabel('titan-central conformance scheduled link key v1 (test only)');
const wrongKey = keyFromLabel('titan-central conformance scheduled link wrong key (test only)');
const scheduledPublicKey = createPublicKey(privateKey);
const jwk = publicJwk(privateKey, KID);
// Central's key validation accepts only kty, crv and x. Scheduled's publicJwk adds kid, alg and use.
const centralKeyConfig = { kid: KID, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, notBefore: '2026-01-01T00:00:00.000Z' };

const IDENTITY = {
  sub: 'central-user-0001', org: 'central-org-0001', lu: 'scheduled-user-0001', la: 'scheduled-account-0001',
};
const nonceFor = (id) => createHash('sha256').update(`scheduled-link-${id}`).digest('base64url').slice(0, 32);
const b64u = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Compact JWS built by hand, for shapes Scheduled's signer refuses to produce. Same wire rules as signLinkAssertion. */
function forge({ header = {}, claims = {}, key = privateKey, id }) {
  const h = { alg: 'EdDSA', typ: 'titan-link+jwt', kid: KID, ...header };
  const c = {
    iss: 'scheduled', aud: 'titan-central', ...IDENTITY, nonce: nonceFor(id),
    iat: NOW_S, exp: NOW_S + 120, ...claims,
  };
  for (const name of Object.keys(c)) if (c[name] === undefined) delete c[name];
  const input = `${b64u(h)}.${b64u(c)}`;
  return `${input}.${sign(null, Buffer.from(input, 'ascii'), key).toString('base64url')}`;
}

const signed = (id, options = {}) => signLinkAssertion({
  privateKey: options.key ?? privateKey,
  keyId: options.keyId ?? KID,
  issuer: 'scheduled',
  audience: options.audience ?? 'titan-central',
  ...IDENTITY,
  nonce: nonceFor(id),
  nowSeconds: options.nowSeconds ?? NOW_S,
  lifetimeSeconds: options.lifetimeSeconds ?? 300,
});

/** Scheduled's own verdict. The nonce store is stubbed to accept, so only the assertion checks decide. */
function scheduledVerdict(token, nowSeconds = NOW_S) {
  try {
    verifyLinkAssertion({
      token, publicKey: scheduledPublicKey, keyId: KID, issuer: 'scheduled', audience: 'titan-central',
      nonceStore: { consume: () => true }, nowSeconds,
    });
    return { result: 'accept' };
  } catch (error) {
    return { result: 'reject', message: error.message };
  }
}

const linkCases = [
  {
    id: 'L-01', name: 'valid-default', token: signed('L-01'), central: 'accept',
    note: 'Scheduled default lifetime (300 seconds). Central would accept this once scheduled is registered.',
  },
  { id: 'L-02', name: 'valid-short-ttl', token: signed('L-02', { lifetimeSeconds: 60 }), central: 'accept' },
  { id: 'L-03', name: 'valid-max-ttl', token: signed('L-03', { lifetimeSeconds: 300 }), central: 'accept' },
  {
    id: 'L-04', name: 'service-audience-used-as-link-audience',
    token: signed('L-04', { audience: 'urn:titan-central:product:scheduled' }), central: 'wrong_audience',
    note: 'Scheduled service audience is not the link audience titan-central.',
  },
  { id: 'L-05', name: 'signed-by-other-key', token: signed('L-05', { key: wrongKey }), central: 'bad_signature' },
  { id: 'L-06', name: 'unknown-kid', token: signed('L-06', { keyId: 'scheduled-unknown-kid' }), central: 'unknown_key' },
  {
    id: 'L-07', name: 'expired', token: signed('L-07', { nowSeconds: NOW_S - 600 }), central: 'expired',
  },
  {
    id: 'L-08', name: 'future-dated-within-clock-skew', token: signed('L-08', { nowSeconds: NOW_S + 10 }), central: 'accept',
    note: 'Central tolerates 30 seconds of future iat. Scheduled has no skew allowance and rejects iat above its clock.',
  },
  {
    id: 'L-09', name: 'future-dated-beyond-clock-skew', token: signed('L-09', { nowSeconds: NOW_S + 120 }), central: 'future_dated',
  },
  {
    id: 'L-10', name: 'lifetime-over-300-seconds',
    token: forge({ id: 'L-10', claims: { exp: NOW_S + 600 } }), central: 'bad_lifetime',
    note: 'Scheduled signer refuses lifetimes over 300 seconds, so the token is forged by hand.',
  },
  {
    id: 'L-11', name: 'forbidden-email-claim',
    token: forge({ id: 'L-11', claims: { email: 'person@example.test' } }), central: 'forbidden_claim',
  },
  {
    id: 'L-12', name: 'algorithm-hs256', token: forge({ id: 'L-12', header: { alg: 'HS256' } }), central: 'bad_algorithm',
  },
  {
    id: 'L-13', name: 'missing-nonce', token: forge({ id: 'L-13', claims: { nonce: undefined } }), central: 'missing_claim',
  },
];

const linkFixture = {
  source: 'scheduled/src/link-assertion.js (signLinkAssertion, verifyLinkAssertion, publicJwk)',
  generatedBy: 'tests/conformance/scheduled/tools/generate-fixtures.mjs',
  now: NOW_ISO,
  issuer: 'scheduled',
  audience: 'titan-central',
  centralKeyConfig,
  cases: linkCases.map((c) => ({
    id: c.id,
    name: c.name,
    token: c.token,
    scheduledVerdict: scheduledVerdict(c.token),
    centralAfterRegistration: c.central,
    ...(c.note ? { note: c.note } : {}),
  })),
};

// ---------- event envelopes ----------

const EVENT_SECRET = 'titan-central conformance scheduled events secret, test only, not a credential';
const OTHER_SECRET = 'titan-central conformance scheduled events other secret, test only, not a credential';
const ORG = '6f1c2a3e-8b4d-4e5f-9a1b-2c3d4e5f6a7b';
const OTHER_ORG = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const envelope = (overrides = {}) => ({
  eventId: '3b7e9f10-2c4d-4e6f-8a9b-0c1d2e3f4a5b',
  organisationId: ORG,
  sourceProduct: 'scheduled',
  eventType: 'booking_created',
  schemaVersion: 1,
  correlationId: 'corr-scheduled-0001',
  idempotencyKey: 'scheduled:booking:bk-0001:created',
  occurredAt: '2026-11-15T09:55:00.000Z',
  payload: { bookingRef: 'bk-0001', status: 'confirmed' },
  ...overrides,
});

const unsignedBodies = {
  valid: envelope(),
  wrongTenant: envelope({ organisationId: OTHER_ORG }),
  unacceptedType: envelope({ eventType: 'booking_cancelled' }),
  stale: envelope({ occurredAt: '2026-11-13T10:00:00.000Z' }),
  future: envelope({ occurredAt: '2026-11-15T11:00:00.000Z' }),
  badSchemaVersion: envelope({ schemaVersion: 0 }),
};

const phpRun = (requests) => {
  const run = spawnSync('php', [path.join(here, 'scheduled-event-verifier.php'), centralPhpDir], {
    input: JSON.stringify({ requests }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`php driver failed: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout);
};

// Signing pass: one HMAC per unsigned envelope, computed by Scheduled's canonicalJson and hash_hmac.
const toSign = Object.entries(unsignedBodies);
const signingResults = phpRun(toSign.map(([, body]) => ({ op: 'sign', body: JSON.stringify(body), secret: EVENT_SECRET })));
const signedBodies = Object.fromEntries(toSign.map(([name, body], i) => [name, { ...body, signature: signingResults[i].signature }]));

// Tampering and wrong-secret variants reuse signatures from the honest envelope or sign with another secret.
const variants = {
  valid: { body: signedBodies.valid, centralOutcome: 'processed' },
  tamperedPayload: {
    body: { ...signedBodies.valid, payload: { bookingRef: 'bk-0001', status: 'cancelled' } },
    centralOutcome: 'bad_signature',
  },
  wrongSecret: {
    body: { ...envelope(), signature: phpRun([{ op: 'sign', body: JSON.stringify(envelope()), secret: OTHER_SECRET }])[0].signature },
    centralOutcome: 'bad_signature',
  },
  wrongTenant: { body: signedBodies.wrongTenant, centralOutcome: 'tenant_mismatch' },
  unacceptedType: { body: signedBodies.unacceptedType, centralOutcome: 'unknown_event_type' },
  unsigned: { body: envelope(), centralOutcome: 'invalid_envelope' },
  stale: { body: signedBodies.stale, centralOutcome: 'stale', note: 'Scheduled rejects anything older than 86400 seconds. Central refuses the same window before any effect.' },
  future: { body: signedBodies.future, centralOutcome: 'from_future', note: 'Scheduled allows 300 seconds of skew. Central refuses anything further ahead before any effect.' },
  badSchemaVersion: { body: signedBodies.badSchemaVersion, centralOutcome: 'invalid_envelope' },
};

const variantNames = Object.keys(variants);
const verdicts = phpRun(variantNames.map((name) => ({
  op: 'verdict', body: JSON.stringify(variants[name].body), secret: EVENT_SECRET, now: NOW_S,
})));

const eventFixture = {
  source: 'core/app/Central/Events/SignedEventVerifier.php (canonicalJson, verify), run via tools/scheduled-event-verifier.php',
  generatedBy: 'tests/conformance/scheduled/tools/generate-fixtures.mjs',
  now: NOW_ISO,
  // Event types are the names C5 registers (packages/control-plane/src/outbox.ts). booking_confirmed is not registered.
  consumer: { consumer: 'scheduled-inbox', organisationId: ORG, eventTypes: ['booking_created'], secret: EVENT_SECRET },
  cases: variantNames.map((name, i) => ({
    id: `E-${String(i + 1).padStart(2, '0')}`,
    name,
    body: variants[name].body,
    scheduledVerdict: verdicts[i].accepted ? { accepted: true } : { accepted: false, reason: verdicts[i].reason },
    centralOutcome: variants[name].centralOutcome,
    ...(variants[name].note ? { note: variants[name].note } : {}),
  })),
};

writeFileSync(path.join(fixturesDir, 'link-assertions.json'), `${JSON.stringify(linkFixture, null, 2)}\n`);
writeFileSync(path.join(fixturesDir, 'event-envelopes.json'), `${JSON.stringify(eventFixture, null, 2)}\n`);
process.stdout.write(`wrote ${linkFixture.cases.length} link cases and ${eventFixture.cases.length} event cases\n`);
