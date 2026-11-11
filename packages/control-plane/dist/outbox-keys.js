import { createHmac, timingSafeEqual } from 'node:crypto';
import { OutboxError, canonicalJson } from './outbox.js';
/** Route secret rotation. A consumer route holds either one open-ended secret (no rotation window) or up to
 * MAX_ROUTE_KEYS keys, each valid from notBefore (inclusive) to notAfter (exclusive). When two keys are given they
 * must overlap in time, so there is always a window in which both verify.
 *
 * Signing: the publisher signs with the valid key whose notBefore is latest (the current key).
 * Verification: a consumer accepts an envelope if ANY key valid at the verification time verifies it. An expired or
 * not-yet-valid key never verifies. The envelope carries no key id, so the signature is the only thing checked.
 *
 * Secrets are never placed in errors or logs. Error messages name the consumer and the field, never a value. */
export const MIN_SECRET_LENGTH = 32;
export const MAX_ROUTE_KEYS = 2;
const KEY_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const SIGNATURE_RE = /^[0-9a-f]{64}$/;
function invalid(message) {
    return new OutboxError('invalid_field', message);
}
function assertSecret(consumer, label, secret) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
        throw invalid(`secret for ${consumer} (${label}) is missing or too short`);
    }
    return secret;
}
function parseInstant(consumer, id, field, value) {
    if (typeof value !== 'string' || !INSTANT_RE.test(value)) {
        throw invalid(`${field} for ${consumer} key ${id} must be an ISO 8601 instant with a time zone`);
    }
    const ms = Date.parse(value);
    if (!Number.isFinite(ms))
        throw invalid(`${field} for ${consumer} key ${id} is not a real instant`);
    return ms;
}
/** Validates a route's key configuration and returns it in resolved form. Throws OutboxError('invalid_field'). */
export function resolveRouteKeys(holder) {
    const hasSecret = holder.secret !== undefined;
    const hasKeys = holder.keys !== undefined;
    if (hasSecret === hasKeys)
        throw invalid(`route ${holder.consumer} must set exactly one of secret or keys`);
    if (hasSecret) {
        return [{ id: 'default', secret: assertSecret(holder.consumer, 'default', holder.secret), notBeforeMs: -Infinity, notAfterMs: Infinity }];
    }
    const keys = holder.keys;
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_ROUTE_KEYS) {
        throw invalid(`route ${holder.consumer} must have between 1 and ${MAX_ROUTE_KEYS} keys`);
    }
    const ids = new Set();
    const secrets = new Set();
    const resolved = keys.map((key) => {
        if (typeof key?.id !== 'string' || !KEY_ID_RE.test(key.id))
            throw invalid(`key id for ${holder.consumer} is invalid`);
        if (ids.has(key.id))
            throw invalid(`key ids for ${holder.consumer} must be unique`);
        ids.add(key.id);
        const secret = assertSecret(holder.consumer, key.id, key.secret);
        if (secrets.has(secret))
            throw invalid(`keys for ${holder.consumer} must not share a secret`);
        secrets.add(secret);
        const notBeforeMs = parseInstant(holder.consumer, key.id, 'notBefore', key.notBefore);
        const notAfterMs = parseInstant(holder.consumer, key.id, 'notAfter', key.notAfter);
        if (!(notBeforeMs < notAfterMs))
            throw invalid(`notBefore must be earlier than notAfter for ${holder.consumer} key ${key.id}`);
        return { id: key.id, secret, notBeforeMs, notAfterMs };
    });
    if (resolved.length === 2) {
        const [a, b] = resolved;
        if (!(Math.max(a.notBeforeMs, b.notBeforeMs) < Math.min(a.notAfterMs, b.notAfterMs))) {
            throw invalid(`rotation keys for ${holder.consumer} must overlap in time`);
        }
    }
    return resolved;
}
export function keyValidAt(key, nowMs) {
    return key.notBeforeMs <= nowMs && nowMs < key.notAfterMs;
}
/** The key the publisher signs with at nowMs: the valid key with the latest notBefore. Undefined when none is valid. */
export function signingKeyAt(keys, nowMs) {
    let best;
    for (const key of keys) {
        if (!keyValidAt(key, nowMs))
            continue;
        if (best === undefined || key.notBeforeMs > best.notBeforeMs)
            best = key;
    }
    return best;
}
/** Verifies the HMAC over the canonical JSON of `unsigned` with any key valid at nowMs. Constant-time per key. */
export function verifySignatureWithKeys(unsigned, signature, keys, nowMs) {
    if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature))
        return false;
    const given = Buffer.from(signature, 'hex');
    let matched = false;
    for (const key of keys) {
        if (!keyValidAt(key, nowMs))
            continue;
        const expected = createHmac('sha256', key.secret).update(canonicalJson(unsigned), 'utf8').digest();
        if (expected.length === given.length && timingSafeEqual(expected, given))
            matched = true;
    }
    return matched;
}
