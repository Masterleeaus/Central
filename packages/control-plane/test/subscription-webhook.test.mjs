import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWebhookSignature, signWebhookPayload, WEBHOOK_TOLERANCE_SECONDS } from '../dist/webhook-verifier.js';
const SECRET = 'fixture-secret-only-for-tests-0123456789';
const body = '{"id":"evt_1"}';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const T = Math.floor(NOW.getTime() / 1000);
const verify = (over = {}) => verifyWebhookSignature({ rawBody: body, signatureHeader: signWebhookPayload(body, T, SECRET), secret: SECRET, now: NOW, ...over });

test('a correctly signed body within tolerance verifies', () => {
  assert.deepEqual(verify(), { ok: true, timestamp: T });
});

test('a tampered body fails the signature', () => {
  const header = signWebhookPayload(body, T, SECRET);
  assert.deepEqual(verifyWebhookSignature({ rawBody: body.replace('evt_1', 'evt_2'), signatureHeader: header, secret: SECRET, now: NOW }), { ok: false, code: 'bad_signature' });
});

test('a signature made with another secret fails', () => {
  assert.equal(verify({ signatureHeader: signWebhookPayload(body, T, 'another-secret-value-0123456789abcd') }).code, 'bad_signature');
});

test('a changed timestamp inside the signed header fails the signature', () => {
  const header = signWebhookPayload(body, T, SECRET).replace(`t=${T}`, `t=${T - 1}`);
  assert.equal(verify({ signatureHeader: header }).code, 'bad_signature');
});

test('missing, empty and malformed signature headers are rejected', () => {
  assert.equal(verify({ signatureHeader: undefined }).code, 'missing_signature');
  assert.equal(verify({ signatureHeader: '   ' }).code, 'missing_signature');
  assert.equal(verify({ signatureHeader: 'v1=' + 'a'.repeat(64) }).code, 'malformed_signature', 'no timestamp');
  assert.equal(verify({ signatureHeader: `t=${T}` }).code, 'malformed_signature', 'no v1');
  assert.equal(verify({ signatureHeader: `t=abc,v1=${'a'.repeat(64)}` }).code, 'malformed_signature', 'non-numeric timestamp');
  assert.equal(verify({ signatureHeader: `t=${T},v1=short` }).code, 'malformed_signature', 'short digest');
  assert.equal(verify({ signatureHeader: `t=${T},t=${T},v1=${'a'.repeat(64)}` }).code, 'malformed_signature', 'duplicate timestamp');
  assert.equal(verify({ signatureHeader: 'garbage' }).code, 'malformed_signature');
});

test('timestamp tolerance: exactly at the limit is accepted, one second beyond is stale', () => {
  const at = (t) => verifyWebhookSignature({ rawBody: body, signatureHeader: signWebhookPayload(body, t, SECRET), secret: SECRET, now: NOW });
  assert.equal(at(T - WEBHOOK_TOLERANCE_SECONDS).ok, true);
  assert.deepEqual(at(T - WEBHOOK_TOLERANCE_SECONDS - 1), { ok: false, code: 'stale_timestamp' });
});

test('timestamp tolerance: a timestamp too far in the future is rejected', () => {
  const at = (t) => verifyWebhookSignature({ rawBody: body, signatureHeader: signWebhookPayload(body, t, SECRET), secret: SECRET, now: NOW });
  assert.equal(at(T + WEBHOOK_TOLERANCE_SECONDS).ok, true);
  assert.deepEqual(at(T + WEBHOOK_TOLERANCE_SECONDS + 1), { ok: false, code: 'future_timestamp' });
});

test('a custom tolerance is honoured', () => {
  assert.equal(verify({ toleranceSeconds: 10, signatureHeader: signWebhookPayload(body, T - 11, SECRET) }).code, 'stale_timestamp');
});

test('signature is checked before timestamp, so a stale unsigned body is reported as a bad signature', () => {
  const header = signWebhookPayload(body, T - 10_000, 'another-secret-value-0123456789abcd');
  assert.equal(verify({ signatureHeader: header }).code, 'bad_signature');
});

test('a rotated secret set accepts any matching v1 digest', () => {
  const good = signWebhookPayload(body, T, SECRET).split(',v1=')[1];
  assert.equal(verify({ signatureHeader: `t=${T},v1=${'0'.repeat(64)},v1=${good}` }).ok, true);
});

test('a secret shorter than 32 characters is refused at call time', () => {
  assert.throws(() => verify({ secret: 'short' }), /at least 32/);
  assert.throws(() => signWebhookPayload(body, T, 'short'), /at least 32/);
});
