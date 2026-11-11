/** HMAC-SHA256 webhook verification over the raw request body (issue #35).
 * Header format: `t=<unix seconds>,v1=<hex digest>[,v1=<hex digest>]`. The signed string is `<t>.<raw body>`.
 * The secret is supplied by the caller from its own secret store. It is never stored or logged here.
 * Provider-specific schemes are implemented by adapters (billing-adapter.ts) and may call this function.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
export const WEBHOOK_TOLERANCE_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;
/** Computes the header value for a body. Used by tests and fake providers; real providers sign on their side. */
export function signWebhookPayload(rawBody, timestamp, secret) {
    assertSecret(secret);
    return `t=${timestamp},v1=${digest(rawBody, timestamp, secret)}`;
}
function assertSecret(secret) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH)
        throw new Error(`webhook secret must be at least ${MIN_SECRET_LENGTH} characters`);
}
function digest(rawBody, timestamp, secret) {
    return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}
/** Checks the signature first and only then the timestamp, so an attacker cannot use the timestamp
 * check as an oracle on unsigned content. Comparison is constant time. */
export function verifyWebhookSignature(input) {
    assertSecret(input.secret);
    const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
    const header = input.signatureHeader;
    if (header === undefined || header.trim() === '')
        return { ok: false, code: 'missing_signature' };
    let timestamp;
    const candidates = [];
    for (const part of header.split(',')) {
        const eq = part.indexOf('=');
        if (eq <= 0)
            return { ok: false, code: 'malformed_signature' };
        const key = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (key === 't') {
            if (timestamp !== undefined || !/^\d{1,12}$/.test(value))
                return { ok: false, code: 'malformed_signature' };
            timestamp = Number(value);
        }
        else if (key === 'v1') {
            if (!/^[0-9a-f]{64}$/i.test(value))
                return { ok: false, code: 'malformed_signature' };
            candidates.push(value.toLowerCase());
        }
    }
    if (timestamp === undefined || candidates.length === 0)
        return { ok: false, code: 'malformed_signature' };
    const expected = Buffer.from(digest(input.rawBody, timestamp, input.secret), 'hex');
    const matched = candidates.some(candidate => {
        const actual = Buffer.from(candidate, 'hex');
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
    if (!matched)
        return { ok: false, code: 'bad_signature' };
    const nowSeconds = Math.floor(input.now.getTime() / 1000);
    const skew = nowSeconds - timestamp;
    if (skew > tolerance)
        return { ok: false, code: 'stale_timestamp' };
    if (skew < -tolerance)
        return { ok: false, code: 'future_timestamp' };
    return { ok: true, timestamp };
}
