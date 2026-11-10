import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { resolveRouteKeys, signingKeyAt, verifyEnvelopeWithKeys, createPublisher, handleInbound, canonicalJson, OutboxError } from '../dist/index.js';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const OLD = 'o'.repeat(40);
const NEW = 'n'.repeat(40);
const ms = (iso) => Date.parse(iso);

// previous: valid 2026-01-01 .. 2026-02-01. current: valid 2026-01-20 .. 2026-12-31. Overlap: 2026-01-20 .. 2026-02-01.
const KEYS = [
  { id: 'previous', secret: OLD, notBefore: '2026-01-01T00:00:00Z', notAfter: '2026-02-01T00:00:00Z' },
  { id: 'current', secret: NEW, notBefore: '2026-01-20T00:00:00Z', notAfter: '2026-12-31T00:00:00Z' },
];
const RESOLVED = resolveRouteKeys({ consumer: 'desk-inbox', keys: KEYS });

function envelopeSignedWith(secret, over = {}) {
  const unsigned = { eventId: '11111111-1111-4111-8111-111111111111', organisationId: ORG_A, sourceProduct: 'desk', eventType: 'example',
    schemaVersion: 1, correlationId: 'c', idempotencyKey: 'k-1', occurredAt: '2026-01-25T00:00:00.000Z', payload: { a: 1 }, ...over };
  const signature = createHmac('sha256', secret).update(canonicalJson(unsigned), 'utf8').digest('hex');
  return { ...unsigned, signature };
}

test('a route holds at most two keys and they must overlap', () => {
  assert.throws(() => resolveRouteKeys({ consumer: 'c', secret: OLD, keys: KEYS }), /exactly one of secret or keys/);
  assert.throws(() => resolveRouteKeys({ consumer: 'c' }), /exactly one of secret or keys/);
  assert.throws(() => resolveRouteKeys({ consumer: 'c', keys: [...KEYS, { id: 'third', secret: 'x'.repeat(40), notBefore: '2026-01-01T00:00:00Z', notAfter: '2026-12-01T00:00:00Z' }] }), /between 1 and 2 keys/);
  assert.throws(() => resolveRouteKeys({ consumer: 'c', keys: [{ ...KEYS[0], secret: 'short' }] }), /too short/);
  assert.throws(() => resolveRouteKeys({ consumer: 'c', keys: [{ ...KEYS[0], notAfter: KEYS[0].notBefore }] }), /earlier than notAfter/);
  assert.throws(() => resolveRouteKeys({ consumer: 'c', keys: [{ ...KEYS[0], notBefore: '2026-01-01 00:00:00' }] }), /ISO 8601/);
  assert.throws(() => resolveRouteKeys({ consumer: 'c', keys: [KEYS[0], { ...KEYS[1], id: 'previous' }] }), /unique/);
  assert.throws(() => resolveRouteKeys({ consumer: 'c', keys: [KEYS[0], { ...KEYS[1], secret: OLD }] }), /must not share a secret/);
  // Windows that do not overlap leave a gap in which nothing can sign: refused.
  assert.throws(() => resolveRouteKeys({ consumer: 'c', keys: [KEYS[0], { ...KEYS[1], notBefore: '2026-02-01T00:00:00Z' }] }), /must overlap/);
});

test('error messages name the consumer and field, never a secret', () => {
  try {
    resolveRouteKeys({ consumer: 'desk-inbox', keys: [{ ...KEYS[0], secret: 'short-but-secret-looking' }] });
    assert.fail('expected refusal');
  } catch (error) {
    assert.ok(error instanceof OutboxError);
    assert.match(error.message, /desk-inbox/);
    assert.doesNotMatch(error.message, /short-but-secret-looking/);
  }
});

test('the signing key is the current key during overlap and the only key outside it', () => {
  assert.equal(signingKeyAt(RESOLVED, ms('2026-01-10T00:00:00Z'))?.id, 'previous');
  assert.equal(signingKeyAt(RESOLVED, ms('2026-01-25T00:00:00Z'))?.id, 'current');
  assert.equal(signingKeyAt(RESOLVED, ms('2026-02-05T00:00:00Z'))?.id, 'current');
  assert.equal(signingKeyAt(RESOLVED, ms('2025-12-31T23:59:59Z')), undefined, 'before any key is valid');
  assert.equal(signingKeyAt(RESOLVED, ms('2027-01-01T00:00:00Z')), undefined, 'after every key has expired');
});

test('during the overlap an envelope signed with either key verifies', () => {
  const overlap = ms('2026-01-25T00:00:00Z');
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(OLD), RESOLVED, overlap), true);
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(NEW), RESOLVED, overlap), true);
});

test('the previous key stops verifying at its notAfter; the current key keeps working', () => {
  const after = ms('2026-02-01T00:00:00Z'); // notAfter is exclusive
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(OLD), RESOLVED, after), false, 'expired previous key');
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(NEW), RESOLVED, after), true);
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(OLD), RESOLVED, ms('2026-01-31T23:59:59Z')), true, 'one second before notAfter');
});

test('a key does not verify before its notBefore', () => {
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(NEW), RESOLVED, ms('2026-01-19T23:59:59Z')), false);
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(NEW), RESOLVED, ms('2026-01-20T00:00:00Z')), true, 'notBefore is inclusive');
});

test('once every key has expired nothing verifies', () => {
  const late = ms('2027-01-01T00:00:00Z');
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(OLD), RESOLVED, late), false);
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(NEW), RESOLVED, late), false);
});

test('an altered envelope or an unknown secret never verifies, even inside the window', () => {
  const at = ms('2026-01-25T00:00:00Z');
  const env = envelopeSignedWith(NEW);
  assert.equal(verifyEnvelopeWithKeys({ ...env, payload: { a: 2 } }, RESOLVED, at), false);
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith('z'.repeat(40)), RESOLVED, at), false);
  assert.equal(verifyEnvelopeWithKeys({ ...env, signature: 'not-hex' }, RESOLVED, at), false);
});

test('a single open-ended secret keeps verifying at any time', () => {
  const single = resolveRouteKeys({ consumer: 'c', secret: NEW });
  assert.equal(verifyEnvelopeWithKeys(envelopeSignedWith(NEW), single, ms('2030-01-01T00:00:00Z')), true);
});

// Scripted pool: claim returns the given rows; the failure update records its error text.
function scriptedPool(rowsToClaim) {
  const sql = [];
  const pool = { async connect() { return { async query(text, values) {
    sql.push([text, values]);
    if (text.includes('FOR UPDATE SKIP LOCKED') && text.includes('WITH due AS')) return { rows: rowsToClaim };
    if (text.includes('SELECT attempts FROM titan.outbox_events')) return { rows: [{ attempts: 1 }] };
    if (text.includes("SET status = 'published'")) return { rows: [{ id: 'x' }] };
    return { rows: [] };
  }, release() {} }; } };
  return { pool, sql };
}
const claimedRow = () => ({ id: '11111111-1111-4111-8111-111111111111', organisation_id: ORG_A, source_product: 'desk', event_type: 'example',
  schema_version: 1, correlation_id: 'c', idempotency_key: 'k-1', payload: { a: 1 }, attempts: 1, created_at: '2026-01-25T00:00:00Z' });

test('the publisher signs with the current key during overlap and with the only valid key after it', async () => {
  for (const [at, expectedSecret] of [['2026-01-25T00:00:00Z', NEW], ['2026-01-10T00:00:00Z', OLD], ['2026-02-05T00:00:00Z', NEW]]) {
    const { pool } = scriptedPool([claimedRow()]);
    const sent = [];
    const pub = createPublisher({ pool, routes: [{ consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], keys: KEYS }],
      now: () => ms(at), transport: { async send(env) { sent.push(env); } } });
    const report = await pub.runOnce();
    assert.equal(report.published, 1, `published at ${at}`);
    assert.equal(verifyEnvelopeWithKeys(sent[0], [{ id: 'k', secret: expectedSecret, notBeforeMs: -Infinity, notAfterMs: Infinity }], ms(at)), true, `signed with the key valid at ${at}`);
  }
});

test('a publisher with no valid key records a redacted failed attempt and sends nothing', async () => {
  const { pool, sql } = scriptedPool([claimedRow()]);
  const sent = [];
  const pub = createPublisher({ pool, routes: [{ consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], keys: KEYS }],
    now: () => ms('2027-06-01T00:00:00Z'), transport: { async send(env) { sent.push(env); } } });
  const report = await pub.runOnce();
  assert.equal(sent.length, 0);
  assert.equal(report.failed, 1);
  const failure = sql.find(([t]) => t.includes('SET status = $2'));
  assert.match(failure[1][3], /no signing key is valid now for consumer desk-inbox/);
  assert.doesNotMatch(failure[1][3], new RegExp(NEW.slice(0, 8)));
  assert.doesNotMatch(failure[1][3], new RegExp(OLD.slice(0, 8)));
});

test('the consumer accepts a previous-key envelope during overlap and refuses it after notAfter', async () => {
  const keys = new Set();
  const tx = { async query(text, values) {
    const k = `${values[0]}|${values[1]}`;
    if (keys.has(k)) return { rows: [], rowCount: 0 };
    keys.add(k);
    return { rows: [{ consumer: values[0] }], rowCount: 1 };
  } };
  const consumer = (at) => ({ consumer: 'desk-inbox', organisationId: ORG_A, eventTypes: ['example'], keys: KEYS, now: () => ms(at) });
  let runs = 0;
  const effect = async () => { runs++; };
  assert.equal(await handleInbound(tx, consumer('2026-01-25T00:00:00Z'), envelopeSignedWith(OLD, { idempotencyKey: 'k-old' }), effect), 'processed');
  await assert.rejects(handleInbound(tx, consumer('2026-02-02T00:00:00Z'), envelopeSignedWith(OLD, { idempotencyKey: 'k-late' }), effect),
    (error) => error.code === 'bad_signature');
  assert.equal(runs, 1, 'a refused envelope runs no effect');
});
