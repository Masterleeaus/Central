import test from 'node:test';
import assert from 'node:assert/strict';
import { redactActivityDetail, assertSafeText, ActivityRedactionError } from '../dist/activity-redaction.js';

const refused = (fn, pattern) => assert.throws(fn, (e) => e instanceof ActivityRedactionError && pattern.test(e.message));

test('plain lifecycle detail passes unchanged', () => {
 const out = redactActivityDetail({ applicationId: 'desk', role: 'manager', state: 'active', count: 3, flag: true, note: null });
 assert.deepEqual(out.detail, { applicationId: 'desk', role: 'manager', state: 'active', count: 3, flag: true, note: null });
 assert.deepEqual(out.stripped, []);
});

test('missing detail is an empty object', () => {
 assert.deepEqual(redactActivityDetail(undefined), { detail: {}, stripped: [] });
 assert.deepEqual(redactActivityDetail(null), { detail: {}, stripped: [] });
});

test('credential-named keys refuse the whole event', () => {
 for (const key of ['token', 'access_token', 'refreshToken', 'client_secret', 'password', 'passwd', 'apiKey', 'authorization', 'Authorization', 'cookie', 'session_id', 'code_verifier', 'nonce', 'id_token', 'private_key', 'bearer', 'jwt', 'assertion']) {
  refused(() => redactActivityDetail({ [key]: 'x' }), /names a credential/);
 }
});

test('personal-data keys are stripped and named, not stored', () => {
 const out = redactActivityDetail({ applicationId: 'field', email: 'x-note', phone: 'n', home_address: 'a', dateOfBirth: 'd', firstName: 'f', ipAddress: 'i' });
 assert.deepEqual(out.detail, { applicationId: 'field' });
 assert.deepEqual(out.stripped.sort(), ['dateOfBirth', 'email', 'firstName', 'home_address', 'ipAddress', 'phone']);
});

test('email address in a value refuses the event', () => {
 refused(() => redactActivityDetail({ note: 'contact jo.smith@example.com today' }), /email address/);
});

test('bearer, JWT and assignment-shaped values refuse the event', () => {
 refused(() => redactActivityDetail({ note: 'Bearer abcdefgh12345678' }), /authorization scheme/);
 refused(() => redactActivityDetail({ note: 'eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl' }), /JSON web token/);
 refused(() => redactActivityDetail({ note: 'password=hunter2' }), /secret assignment/);
 refused(() => redactActivityDetail({ note: 'https://user:pw@host.example' }), /email address|URL with credentials/);
});

test('opaque long token-shaped values refuse the event, UUIDs do not', () => {
 refused(() => redactActivityDetail({ ref: 'Qz8fK2mP9xL4vB7nR1tY6wH3cJ5dG0sA' }), /credential/);
 assert.deepEqual(redactActivityDetail({ ref: '11111111-2222-4333-8444-555555555555' }).detail, { ref: '11111111-2222-4333-8444-555555555555' });
});

test('nested objects, arrays, non-finite numbers and oversized strings refuse the event', () => {
 refused(() => redactActivityDetail({ a: { b: 1 } }), /nested/);
 refused(() => redactActivityDetail({ a: [1] }), /array/);
 refused(() => redactActivityDetail({ a: Number.NaN }), /finite/);
 refused(() => redactActivityDetail({ a: 'x'.repeat(129) }), /longer than 128/);
 refused(() => redactActivityDetail({ a: 'line\nbreak' }), /control characters/);
});

test('bad keys, too many keys and oversized detail refuse the event', () => {
 refused(() => redactActivityDetail({ 'bad key': 1 }), /invalid shape/);
 refused(() => redactActivityDetail({ ['1st']: 1 }), /invalid shape/);
 const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i]));
 refused(() => redactActivityDetail(many), /more than 12 keys/);
 const big = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, 'v'.repeat(120)]));
 refused(() => redactActivityDetail(big), /larger than 1024 bytes/);
});

test('non-plain objects are refused', () => {
 refused(() => redactActivityDetail([]), /plain object/);
 refused(() => redactActivityDetail('text'), /plain object/);
 refused(() => redactActivityDetail(new Map()), /plain object/);
 refused(() => redactActivityDetail(Object.create({ inherited: 1 })), /plain object/);
});

test('identifiers refuse credential or address shapes', () => {
 assert.equal(assertSafeText('actorId', 'usr_123'), 'usr_123');
 refused(() => assertSafeText('actorId', 'jo@example.com'), /email address/);
 refused(() => assertSafeText('targetId', 'Qz8fK2mP9xL4vB7nR1tY6wH3cJ5dG0sA'), /credential/);
 refused(() => assertSafeText('targetId', ''), /non-empty/);
 refused(() => assertSafeText('targetId', 'x'.repeat(129)), /at most 128/);
});
