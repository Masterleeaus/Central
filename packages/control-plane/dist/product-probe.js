import { inspectProductContract, normaliseTrustedOrigin } from './product-registry.js';
/**
 * Health and version probes for registered products (issue #29). DRAFT paths.
 *
 * A probe is informational. Its result is returned to the caller and is never read by
 * access checks (access.ts), entitlements or the OIDC plans. A failing probe reports
 * unhealthy and nothing else changes.
 *
 * No network access happens here except through the injected fetch. Redirects are not followed,
 * each request has a timeout, and response bodies are capped. Errors are reported as reason
 * codes, never as messages from the remote side.
 */
export const PROBE_PATHS = Object.freeze({ health: '/titan/v1/health', version: '/titan/v1/version' });
export const DEFAULT_PROBE_TIMEOUT_MS = 2000;
export const DEFAULT_PROBE_MAX_BODY_BYTES = 4096;
class ProbeFailure extends Error {
    reason;
    constructor(reason) {
        super(reason);
        this.reason = reason;
    }
}
/** Rejects when the signal aborts, so a fetch or body read that ignores the signal still times out. */
function untilAborted(promise, signal) {
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(new ProbeFailure('timeout'));
        if (signal.aborted)
            return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then((v) => { signal.removeEventListener('abort', onAbort); resolve(v); }, (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
    });
}
async function readBounded(response, maxBytes, signal) {
    if (!response.body)
        return '';
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const chunk = await untilAborted(reader.read(), signal);
        if (chunk.done)
            break;
        const bytes = chunk.value ?? new Uint8Array();
        size += bytes.byteLength;
        if (size > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new ProbeFailure('body_too_large');
        }
        chunks.push(bytes);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
        joined.set(c, offset);
        offset += c.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}
async function getJson(url, fetchImpl, timeoutMs, maxBytes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await untilAborted(fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json' } }), controller.signal);
        }
        catch (e) {
            if (e instanceof ProbeFailure)
                throw e;
            throw new ProbeFailure('network_error');
        }
        if (response.status >= 300 && response.status < 400)
            throw new ProbeFailure('redirect');
        if (response.status !== 200)
            throw new ProbeFailure('http_status');
        const text = await readBounded(response, maxBytes, controller.signal);
        try {
            return JSON.parse(text);
        }
        catch {
            throw new ProbeFailure('invalid_body');
        }
    }
    finally {
        clearTimeout(timer);
    }
}
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
async function runCheck(fn, fallback) {
    try {
        return await fn();
    }
    catch (e) {
        if (e instanceof ProbeFailure)
            return { ...fallback(), ok: false, reason: e.reason };
        return { ...fallback(), ok: false, reason: 'network_error' };
    }
}
/**
 * Probes one registered product. Never throws: every failure is returned as unhealthy with a reason.
 * A product with no validated origin is not fetched.
 */
export async function probeProduct(product, options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const maxBytes = options.maxBodyBytes ?? DEFAULT_PROBE_MAX_BODY_BYTES;
    if (product.serviceOrigin === null) {
        const notConfigured = { ok: false, reason: 'not_configured' };
        return { productId: product.id, healthy: false, health: notConfigured, version: notConfigured };
    }
    let origin;
    try {
        origin = normaliseTrustedOrigin(product.serviceOrigin);
    }
    catch {
        const invalid = { ok: false, reason: 'not_configured' };
        return { productId: product.id, healthy: false, health: invalid, version: invalid };
    }
    const health = await runCheck(async () => {
        const body = await getJson(`${origin}${PROBE_PATHS.health}`, options.fetch, timeoutMs, maxBytes);
        if (!isRecord(body))
            throw new ProbeFailure('invalid_body');
        if (body.status !== 'ok')
            throw new ProbeFailure('health_not_ok');
        return { ok: true };
    }, () => ({ ok: false }));
    const version = await runCheck(async () => {
        const body = await getJson(`${origin}${PROBE_PATHS.version}`, options.fetch, timeoutMs, maxBytes);
        if (!isRecord(body) || typeof body.contractVersion !== 'string' || !Array.isArray(body.capabilities)
            || !body.capabilities.every((c) => typeof c === 'string')) {
            throw new ProbeFailure('invalid_body');
        }
        const capabilities = body.capabilities;
        const inspection = inspectProductContract(product, { contractVersion: body.contractVersion, capabilities });
        if (!inspection.compatible)
            return { ok: false, reason: 'contract_incompatible', contractVersion: body.contractVersion, inspection };
        return { ok: true, contractVersion: body.contractVersion, inspection };
    }, () => ({ ok: false }));
    return { productId: product.id, healthy: health.ok && version.ok, health, version };
}
