#!/usr/bin/env node
/**
 * Builds contracts/vectors/v1 (issue #105).
 *
 * Usage: node tools/contract-vectors/generate.mjs   (run after `npm run build -w @titan-central/control-plane`)
 *
 * Ed25519 test keys and the service bearer are generated in this process only. Private keys and the bearer are
 * not written anywhere: the output holds public JWKs, signed test tokens and the test bearer value, all of which
 * are fixtures that no deployment accepts. Every expected outcome is checked against the live verifier and handler
 * before any file is written, so a vector can never record behaviour the implementation does not have.
 */
import { generateKeyPairSync, createHmac, randomBytes, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runLinkFile, runServiceFile, VECTOR_DIR } from './runner.mjs';

export const CONTRACT_VERSION = '1.0.0';
const NOW = '2026-11-15T12:00:00.000Z';
const NOW_S = Math.floor(Date.parse(NOW) / 1000);
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const nonce = () => randomBytes(18).toString('base64url');

// ---------------------------------------------------------------- link-assertion

function testKey(kid, notBefore, notAfter) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, config: { kid, jwk: { kty: 'OKP', crv: 'Ed25519', x }, notBefore, ...(notAfter ? { notAfter } : {}) } };
}
const K = {
  sortedOld: testKey('sorted-2026-01', '2026-01-01T00:00:00.000Z', '2026-11-20T00:00:00.000Z'),
  sortedCurrent: testKey('sorted-2026-11', '2026-11-10T00:00:00.000Z'),
  sortedFuture: testKey('sorted-2027-01', '2027-01-01T00:00:00.000Z'),
  sortedRetired: testKey('sorted-2025-12', '2025-01-01T00:00:00.000Z', '2025-12-31T00:00:00.000Z'),
  supercharged: testKey('supercharged-2026-01', '2026-01-01T00:00:00.000Z'),
  lms: testKey('lms-2026-01', '2026-01-01T00:00:00.000Z'),
  // Never published: signs with a kid that is configured, or with an unconfigured kid.
  otherKeyForConfiguredKid: testKey('sorted-2026-11', '2026-11-10T00:00:00.000Z'),
  rogue: testKey('sorted-rogue', '2026-01-01T00:00:00.000Z'),
};
const KEY_SETS = [
  { productId: 'sorted', keys: [K.sortedOld.config, K.sortedCurrent.config, K.sortedFuture.config, K.sortedRetired.config] },
  { productId: 'supercharged', keys: [K.supercharged.config] },
  { productId: 'lms', keys: [K.lms.config] },
];
const SORTED_ONLY_KEY_SETS = [{ productId: 'sorted', keys: [K.sortedCurrent.config] }];
const EXPECTATION = {
  applicationId: 'field', logtoSubject: 'usr_abcdef12', logtoOrganisationId: 'org_tenanta01',
  localUserId: 'user-0001-abcd', localAccountId: 'acct-0001-abcd',
};

const claims = (over = {}) => ({
  iss: 'sorted', aud: 'titan-central', sub: 'usr_abcdef12', org: 'org_tenanta01', lu: 'user-0001-abcd',
  la: 'acct-0001-abcd', nonce: nonce(), iat: NOW_S, exp: NOW_S + 120, ...over,
});
/** Signs with EdDSA. Undefined claim values are dropped by JSON encoding, which is how a claim is omitted. */
function jws(key, body, header = {}) {
  const h = b64({ alg: 'EdDSA', typ: 'titan-link+jwt', kid: key.kid, ...header });
  const p = b64(body);
  const sig = sign(null, Buffer.from(`${h}.${p}`, 'ascii'), key.privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}
const unsigned = (body) => `${b64({ alg: 'none', typ: 'titan-link+jwt', kid: K.sortedCurrent.kid })}.${b64(body)}.`;
function hs256(body) {
  const h = b64({ alg: 'HS256', typ: 'titan-link+jwt', kid: K.sortedCurrent.kid });
  const p = b64(body);
  return `${h}.${p}.${createHmac('sha256', randomBytes(32)).update(`${h}.${p}`).digest('base64url')}`;
}
const acceptStep = (token, c) => ({
  token, expect: 'accept', result: { productId: c.iss, nonce: c.nonce, issuedAt: iso(c.iat), expiresAt: iso(c.exp) },
});
const rejectStep = (token, code, extra = {}) => ({ token, expect: 'reject', code, ...extra });

function linkCases() {
  const cases = [];
  const add = (id, description, expect, steps, extra = {}) => cases.push({ id, description, expect, ...extra, steps });

  // accept
  let c = claims();
  add('accept-sorted-current-key', 'Correctly signed, in-window assertion for the field application under the current Sorted key.', 'accept',
    [acceptStep(jws(K.sortedCurrent, c), c)]);
  c = claims();
  add('accept-sorted-old-key-in-overlap', 'Previous Sorted key is still accepted before its notAfter during rotation.', 'accept',
    [acceptStep(jws(K.sortedOld, c, { kid: K.sortedOld.kid }), c)]);
  c = claims({ iat: NOW_S + 30, exp: NOW_S + 150 });
  add('accept-iat-at-clock-skew-limit', 'iat exactly 30 seconds in the future is inside the allowed skew.', 'accept',
    [acceptStep(jws(K.sortedCurrent, c), c)]);
  c = claims({ iat: NOW_S, exp: NOW_S + 300 });
  add('accept-lifetime-exactly-300-seconds', 'exp minus iat of 300 seconds is the maximum accepted lifetime.', 'accept',
    [acceptStep(jws(K.sortedCurrent, c), c)]);
  c = claims({ iat: NOW_S - 299, exp: NOW_S + 1 });
  add('accept-one-second-before-expiry', 'Assertion accepted one second before exp.', 'accept',
    [acceptStep(jws(K.sortedCurrent, c), c)]);
  c = claims({ iss: 'supercharged' });
  add('accept-supercharged-for-desk', 'Supercharged assertion for the desk application.', 'accept',
    [acceptStep(jws(K.supercharged, c), c)], { expectation: { applicationId: 'desk' } });
  c = claims({ iss: 'lms' });
  add('accept-lms-for-academy', 'LMS assertion for the academy application.', 'accept',
    [acceptStep(jws(K.lms, c), c)], { expectation: { applicationId: 'academy' } });
  const c1 = claims();
  const c2 = claims();
  add('accept-distinct-nonces-in-sequence', 'Two assertions with distinct nonces are both accepted in one sequence.', 'accept',
    [acceptStep(jws(K.sortedCurrent, c1), c1), acceptStep(jws(K.sortedCurrent, c2), c2)]);
  c = claims();
  add('accept-after-rejected-attempt-keeps-nonce', 'A rejected attempt does not consume its nonce; the same assertion is then accepted.', 'accept',
    [rejectStep(jws(K.sortedCurrent, c), 'organisation_mismatch', { expectation: { logtoOrganisationId: 'org_tenantb01' } }),
      acceptStep(jws(K.sortedCurrent, c), c)]);

  // reject: algorithm and header
  c = claims();
  add('reject-alg-none-empty-signature', 'alg none with no signature segment.', 'reject',
    [rejectStep(unsigned(c), 'malformed')]);
  c = claims();
  add('reject-alg-none-with-signature-bytes', 'alg none with arbitrary signature bytes is refused on algorithm.', 'reject',
    [rejectStep(`${b64({ alg: 'none', typ: 'titan-link+jwt', kid: K.sortedCurrent.kid })}.${b64(c)}.AAAA`, 'bad_algorithm')]);
  c = claims();
  add('reject-alg-hs256', 'HS256 with a shared secret; the verifier never uses key material for it.', 'reject',
    [rejectStep(hs256(c), 'bad_algorithm')]);
  c = claims();
  add('reject-typ-not-link-jwt', 'Header typ is JWT, not titan-link+jwt.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c, { typ: 'JWT' }), 'bad_algorithm')]);
  c = claims();
  add('reject-header-extra-field', 'Header carries jku, which is not an allowed header field.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c, { jku: 'https://keys.example.test/jwks.json' }), 'malformed')]);
  c = claims();
  add('reject-unknown-key-id', 'kid is not in the product key set.', 'reject',
    [rejectStep(jws(K.rogue, c), 'unknown_key')]);
  c = claims();
  add('reject-key-not-yet-valid', 'kid is configured but notBefore is in the future.', 'reject',
    [rejectStep(jws(K.sortedFuture, c, { kid: K.sortedFuture.kid }), 'key_inactive')]);
  c = claims();
  add('reject-key-after-not-after', 'kid is configured but notAfter has passed.', 'reject',
    [rejectStep(jws(K.sortedRetired, c, { kid: K.sortedRetired.kid }), 'key_inactive')]);

  // reject: signature
  c = claims();
  const signed = jws(K.sortedCurrent, c).split('.');
  add('reject-tampered-payload', 'Payload changed under the original signature.', 'reject',
    [rejectStep(`${signed[0]}.${b64({ ...c, la: 'acct-attacker-0002' })}.${signed[2]}`, 'bad_signature')]);
  c = claims();
  add('reject-signed-by-other-key', 'Signed with a key other than the configured key for that kid.', 'reject',
    [rejectStep(jws(K.otherKeyForConfiguredKid, c), 'bad_signature')]);

  // reject: claims and forbidden fields
  c = claims({ email: 'jane@example.com' });
  add('reject-forbidden-email-claim', 'An email claim is present, even alongside valid identifiers.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'forbidden_claim')]);
  c = claims({ name: 'Jane Smith' });
  add('reject-forbidden-display-name-claim', 'A name claim is present.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'forbidden_claim')]);
  c = claims({ nonce: undefined });
  add('reject-missing-nonce', 'Required nonce claim is absent.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'missing_claim')]);
  c = claims({ nonce: 'short-nonce-1' });
  add('reject-nonce-too-short', 'Nonce is under 22 characters.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'malformed')]);
  c = claims({ nonce: 'abc+def/ghi+jkl/mno+pqr/stu+vw' });
  add('reject-nonce-outside-charset', 'Nonce contains base64 characters that are not base64url.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'malformed')]);

  // reject: identity and lifetime
  c = claims({ iss: 'mystery' });
  add('reject-unknown-product', 'iss is not a known product.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'unknown_product')]);
  c = claims({ iss: 'supercharged' });
  add('reject-product-mismatch', 'Supercharged assertion used to link a field (Sorted) application.', 'reject',
    [rejectStep(jws(K.supercharged, c), 'product_mismatch')], { expectation: { applicationId: 'field' } });
  c = claims({ iss: 'supercharged' });
  add('reject-product-without-key-set', 'Known product with no key set configured.', 'reject',
    [rejectStep(jws(K.supercharged, c), 'unknown_product')], { key_sets: SORTED_ONLY_KEY_SETS, expectation: { applicationId: 'desk' } });
  c = claims({ aud: 'some-other-service' });
  add('reject-wrong-audience', 'aud is not titan-central.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'wrong_audience')]);
  c = claims({ iat: NOW_S - 200, exp: NOW_S });
  add('reject-expired-exp-equals-now', 'exp equal to the verifier clock is already expired.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'expired')]);
  c = claims({ iat: NOW_S - 200, exp: NOW_S - 1 });
  add('reject-expired-in-past', 'exp is before the verifier clock.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'expired')]);
  c = claims({ iat: NOW_S + 60, exp: NOW_S + 180 });
  add('reject-future-dated-beyond-skew', 'iat is 60 seconds ahead, beyond the 30 second skew.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'future_dated')]);
  c = claims({ exp: NOW_S + 301 });
  add('reject-lifetime-over-300-seconds', 'exp minus iat is 301 seconds.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'bad_lifetime')]);
  c = claims({ exp: NOW_S });
  add('reject-lifetime-zero', 'exp equal to iat is not a positive lifetime.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'bad_lifetime')]);

  // reject: identifiers and bindings
  c = claims({ sub: 'jane@example.com' });
  add('reject-email-as-subject', 'An email address used as the subject identifier.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'identifier_not_permitted')], { expectation: { logtoSubject: 'jane@example.com' } });
  c = claims({ la: 'Jane Smith' });
  add('reject-display-name-as-account', 'A display name with a space used as the local account id.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'identifier_not_permitted')], { expectation: { localAccountId: 'Jane Smith' } });
  c = claims({ sub: 'usr_otherperson' });
  add('reject-subject-mismatch', 'sub differs from Central\'s identity record.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'subject_mismatch')]);
  c = claims({ org: 'org_unrelated1' });
  add('reject-organisation-mismatch', 'org differs from Central\'s organisation record.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'organisation_mismatch')]);
  c = claims({ la: 'acct-other-0002' });
  add('reject-account-mismatch', 'la differs from the command\'s local account.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'account_mismatch')]);
  c = claims({ lu: 'user-other-0002' });
  add('reject-local-user-mismatch', 'lu differs from the command\'s local user.', 'reject',
    [rejectStep(jws(K.sortedCurrent, c), 'account_mismatch')]);

  // reject: replay and malformed transport
  c = claims();
  const replayT2 = claims({ nonce: c.nonce, iat: NOW_S + 1, exp: NOW_S + 121 });
  add('reject-replayed-nonce', 'Same nonce resubmitted, then a different token carrying the same nonce.', 'reject',
    [acceptStep(jws(K.sortedCurrent, c), c), rejectStep(jws(K.sortedCurrent, c), 'replayed'),
      rejectStep(jws(K.sortedCurrent, replayT2), 'replayed')]);
  add('reject-two-segments', 'Token with two segments.', 'reject', [rejectStep('a.b', 'malformed')]);
  add('reject-header-not-json', 'Header segment decodes to non-JSON.', 'reject',
    [rejectStep(`${b64('not json')}.${b64(claims())}.AAAA`, 'malformed')]);
  add('reject-payload-is-array', 'Payload decodes to a JSON array, not an object.', 'reject',
    [rejectStep(`${b64({ alg: 'EdDSA', typ: 'titan-link+jwt', kid: K.sortedCurrent.kid })}.${b64('[]')}.AAAA`, 'malformed')]);
  add('reject-token-over-4096-characters', 'Token longer than the 4096 character limit.', 'reject',
    [rejectStep('a'.repeat(4097), 'malformed')]);

  return cases.map(({ key_sets, expectation, ...rest }) => ({
    ...rest,
    ...(key_sets ? { key_sets } : {}),
    ...(expectation ? { expectation } : {}),
  }));
}

// ---------------------------------------------------------------- service-decision

const SERVICE_PATH = '/v1/integrations/academy/decision';
const ORG_UUID = '00000000-0000-4000-8000-000000000001';
const DECISION = {
  allowed: true, applicationId: 'academy', organisationId: 'central-org-0001',
  localUserId: 'skilled-user-0001', localAccountId: 'account-0001',
  membershipRevision: 1, entitlementRevision: 1, linkRevision: 1,
};
const ALLOW = { mode: 'allow', value: DECISION };
const EXPIRES_AT = iso(NOW_S + 300);

function serviceCases(config) {
  const requestId = randomBytes(32).toString('base64url');
  const headers = { authorization: 'Bearer {{bearer}}', 'content-type': 'application/json', accept: 'application/json' };
  const body = { applicationId: 'academy', issuer: config.issuer, subject: 'central-user-0001', organisationId: ORG_UUID, requestId };
  const without = (key) => { const { [key]: _removed, ...rest } = body; return rest; };
  const req = (over = {}) => ({ method: 'POST', path: SERVICE_PATH, headers, body, ...over });
  const cases = [];
  const add = (id, description, request, decision, expect) => cases.push({ id, description, request, decision, expect });
  const ok = (value, subject = body.subject, reqId = requestId) => ({
    status: 200, decide_called: true,
    body: { issuer: config.issuer, subject, requestId: reqId, decision: { ...value, expiresAt: EXPIRES_AT } },
  });
  const err = (status, error, decideCalled = false) => ({ status, decide_called: decideCalled, body: { error } });

  // accept
  add('accept-allow', 'Valid Central-signed-off request with an allowed decision; response echoes issuer, subject and requestId and sets expiresAt 300 seconds ahead.',
    req(), ALLOW, ok(DECISION));
  add('accept-subject-with-allowed-punctuation', 'Subject uses colon, underscore and hyphen, all inside the identifier charset.',
    req({ body: { ...body, subject: 'central:user_0001-a' } }), ALLOW, ok(DECISION, 'central:user_0001-a'));
  add('accept-subject-at-200-characters', 'Subject at the 200 character maximum.',
    req({ body: { ...body, subject: 'u'.repeat(200) } }), ALLOW, ok(DECISION, 'u'.repeat(200)));
  add('accept-uppercase-organisation-uuid', 'organisationId in upper case is accepted (case-insensitive UUID).',
    req({ body: { ...body, organisationId: ORG_UUID.toUpperCase() } }), ALLOW, ok(DECISION));

  // not handled
  add('reject-unrelated-path-not-handled', 'A different path is not this endpoint; the server answers 404 and no decision runs.',
    req({ path: '/v1/other/decision' }), ALLOW, { status: 404, decide_called: false });

  // method, path, auth
  const { body: _unused, ...getReq } = req();
  add('reject-get-method', 'GET is refused with 405 before authentication.',
    { ...getReq, method: 'GET' }, ALLOW, err(405, 'method_not_allowed'));
  add('reject-query-string', 'A query string on the path is refused with 400 before authentication.',
    req({ path: `${SERVICE_PATH}?x=1` }), ALLOW, err(400, 'invalid_request'));
  add('reject-missing-authorization', 'No Authorization header.',
    req({ headers: { 'content-type': 'application/json', accept: 'application/json' } }), ALLOW, err(401, 'unauthenticated'));
  add('reject-wrong-bearer', 'Bearer of the right shape with a different value.',
    req({ headers: { ...headers, authorization: 'Bearer {{wrong_bearer}}' } }), ALLOW, err(401, 'unauthenticated'));
  add('reject-short-bearer', 'Bearer shorter than 32 characters.',
    req({ headers: { ...headers, authorization: 'Bearer short-token' } }), ALLOW, err(401, 'unauthenticated'));
  add('reject-bearer-outside-charset', 'Bearer containing a character outside the contract charset.',
    req({ headers: { ...headers, authorization: `Bearer ${'a'.repeat(31)}!` } }), ALLOW, err(401, 'unauthenticated'));

  // body
  add('reject-content-type-text-plain', 'Content-Type text/plain.',
    req({ headers: { ...headers, 'content-type': 'text/plain' } }), ALLOW, err(400, 'invalid_request'));
  add('reject-content-type-non-utf8-charset', 'JSON with a non-UTF-8 charset parameter.',
    req({ headers: { ...headers, 'content-type': 'application/json; charset=latin1' } }), ALLOW, err(400, 'invalid_request'));
  add('reject-invalid-json', 'Body is truncated JSON.',
    req({ body: undefined, body_raw: '{"applicationId":' }), ALLOW, err(400, 'invalid_request'));
  add('reject-body-over-2048-bytes', 'Body larger than 2048 bytes.',
    req({ body: undefined, body_raw: JSON.stringify({ ...body, padding: 'x'.repeat(2100) }) }), ALLOW, err(400, 'invalid_request'));
  add('reject-array-body', 'Top-level JSON array.',
    req({ body: [] }), ALLOW, err(400, 'invalid_request'));
  add('reject-extra-email-field', 'Request carries an email field, which is not part of the contract.',
    req({ body: { ...body, email: 'jane@example.com' } }), ALLOW, err(400, 'invalid_request'));
  add('reject-wrong-application', 'applicationId is field, not academy.',
    req({ body: { ...body, applicationId: 'field' } }), ALLOW, err(400, 'invalid_request'));
  add('reject-wrong-issuer', 'issuer does not match the configured Central issuer.',
    req({ body: { ...body, issuer: 'https://evil.example.test' } }), ALLOW, err(400, 'invalid_request'));
  add('reject-organisation-not-uuid', 'organisationId is not a UUID.',
    req({ body: { ...body, organisationId: 'org_tenanta01' } }), ALLOW, err(400, 'invalid_request'));
  add('reject-request-id-too-short', 'requestId is 31 characters.',
    req({ body: { ...body, requestId: requestId.slice(0, 31) } }), ALLOW, err(400, 'invalid_request'));
  add('reject-missing-subject', 'subject is absent.',
    req({ body: without('subject') }), ALLOW, err(400, 'invalid_request'));
  add('reject-email-as-subject', 'An email address used as subject.',
    req({ body: { ...body, subject: 'jane@example.com' } }), ALLOW, err(400, 'invalid_request'));
  add('reject-legacy-body-without-organisation', 'Body without organisationId, as sent by the earlier Skilled client. Fails closed.',
    req({ body: without('organisationId') }), ALLOW, err(400, 'invalid_request'));

  // decision outcome
  add('reject-decision-denied', 'Central denies the account; no decision is returned.',
    req(), { mode: 'deny' }, err(403, 'account_not_authorised', true));
  add('reject-decision-backend-unavailable', 'The decision backend throws; the server answers 503 without detail.',
    req(), { mode: 'unavailable' }, err(503, 'decision_unavailable', true));

  return cases;
}

// ---------------------------------------------------------------- build

async function main() {
  const serviceConfig = {
    issuer: 'https://central.example.test',
    audience: 'skilled-academy',
    bearer: randomBytes(48).toString('base64url'),
    wrong_bearer: randomBytes(48).toString('base64url'),
  };
  const link = {
    contract: 'titan-central.link-assertion',
    contract_version: CONTRACT_VERSION,
    source: 'packages/control-plane/src/link-assertion.ts (docs/LINKING.md)',
    notes: [
      'Ed25519 test keys were generated when this file was built. Only public JWKs are stored; the private keys were discarded, so no key here signs anything real.',
      'A case runs in order against one verifier and one nonce store. Each step expectation is merged over the case expectation, then the file default.',
      'Rejection codes are the exact LinkRejectionCode values. Products should assert the code, not only that the assertion was refused.',
      'expect is the outcome of the final step.',
    ],
    audience: 'titan-central',
    now: NOW,
    default_expectation: EXPECTATION,
    key_sets: KEY_SETS,
    cases: linkCases(),
  };
  const service = {
    contract: 'titan-central.service-decision',
    contract_version: CONTRACT_VERSION,
    source: 'apps/control-api/src/service-decision-handler.mjs with service-decision-auth.mjs, -request.mjs',
    notes: [
      'This endpoint authenticates with a shared service bearer, not a signed token, so these are unsigned request and response pairs.',
      'config.bearer and config.wrong_bearer are random test values generated when this file was built. Placeholders in headers are replaced by the runner.',
      'Each case runs the real handler on loopback with the stubbed decision named in decision. decide_called states whether the decision function must run.',
    ],
    now: NOW,
    config: serviceConfig,
    cases: serviceCases(serviceConfig),
  };
  const counts = { link: await runLinkFile(link), service: await runServiceFile(service) };

  mkdirSync(fileURLToPath(VECTOR_DIR), { recursive: true });
  const out = (name, text) => writeFileSync(new URL(name, VECTOR_DIR), text);
  out('VERSION', `${CONTRACT_VERSION}\n`);
  out('link-assertion.json', `${JSON.stringify(link, null, 2)}\n`);
  out('service-decision.json', `${JSON.stringify(service, null, 2)}\n`);
  console.log(JSON.stringify({ version: CONTRACT_VERSION, counts }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
