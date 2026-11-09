import { inspectProductContract, normaliseTrustedOrigin } from './product-registry.js';
import type { ContractInspection, RegisteredProduct } from './product-registry.js';

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

export interface ProbeReaderChunk { done: boolean; value?: Uint8Array }
export interface ProbeBodyReader {
  read(): Promise<ProbeReaderChunk>;
  cancel(reason?: unknown): Promise<unknown>;
}
export interface ProbeResponse {
  status: number;
  body: { getReader(): ProbeBodyReader } | null;
}
export interface ProbeRequestInit {
  method: 'GET';
  redirect: 'manual';
  signal: AbortSignal;
  headers: Readonly<Record<string, string>>;
}
export type ProbeFetch = (url: string, init: ProbeRequestInit) => Promise<ProbeResponse>;

export type ProbeReason =
  | 'not_configured'
  | 'timeout'
  | 'network_error'
  | 'redirect'
  | 'http_status'
  | 'body_too_large'
  | 'invalid_body'
  | 'health_not_ok'
  | 'contract_incompatible';

export interface ProbeCheck {
  ok: boolean;
  reason?: ProbeReason;
}

export interface VersionCheck extends ProbeCheck {
  contractVersion?: string;
  inspection?: ContractInspection;
}

export interface ProductProbeResult {
  productId: RegisteredProduct['id'];
  /** True only when the health check passed and the reported contract is compatible. */
  healthy: boolean;
  health: ProbeCheck;
  version: VersionCheck;
}

export interface ProbeOptions {
  fetch: ProbeFetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

class ProbeFailure extends Error {
  constructor(readonly reason: ProbeReason) {
    super(reason);
  }
}

/** Rejects when the signal aborts, so a fetch or body read that ignores the signal still times out. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new ProbeFailure('timeout'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

async function readBounded(response: ProbeResponse, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await untilAborted(reader.read(), signal);
    if (chunk.done) break;
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
  for (const c of chunks) { joined.set(c, offset); offset += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

async function getJson(
  url: string,
  fetchImpl: ProbeFetch,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: ProbeResponse;
    try {
      response = await untilAborted(
        fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json' } }),
        controller.signal,
      );
    } catch (e) {
      if (e instanceof ProbeFailure) throw e;
      throw new ProbeFailure('network_error');
    }
    if (response.status >= 300 && response.status < 400) throw new ProbeFailure('redirect');
    if (response.status !== 200) throw new ProbeFailure('http_status');
    const text = await readBounded(response, maxBytes, controller.signal);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ProbeFailure('invalid_body');
    }
  } finally {
    clearTimeout(timer);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

async function runCheck<T extends ProbeCheck>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProbeFailure) return { ...fallback(), ok: false, reason: e.reason };
    return { ...fallback(), ok: false, reason: 'network_error' };
  }
}

/**
 * Probes one registered product. Never throws: every failure is returned as unhealthy with a reason.
 * A product with no validated origin is not fetched.
 */
export async function probeProduct(product: RegisteredProduct, options: ProbeOptions): Promise<ProductProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const maxBytes = options.maxBodyBytes ?? DEFAULT_PROBE_MAX_BODY_BYTES;
  if (product.serviceOrigin === null) {
    const notConfigured = { ok: false, reason: 'not_configured' as const };
    return { productId: product.id, healthy: false, health: notConfigured, version: notConfigured };
  }
  let origin: string;
  try {
    origin = normaliseTrustedOrigin(product.serviceOrigin);
  } catch {
    const invalid = { ok: false, reason: 'not_configured' as const };
    return { productId: product.id, healthy: false, health: invalid, version: invalid };
  }

  const health = await runCheck<ProbeCheck>(
    async () => {
      const body = await getJson(`${origin}${PROBE_PATHS.health}`, options.fetch, timeoutMs, maxBytes);
      if (!isRecord(body)) throw new ProbeFailure('invalid_body');
      if (body.status !== 'ok') throw new ProbeFailure('health_not_ok');
      return { ok: true };
    },
    () => ({ ok: false }),
  );

  const version = await runCheck<VersionCheck>(
    async () => {
      const body = await getJson(`${origin}${PROBE_PATHS.version}`, options.fetch, timeoutMs, maxBytes);
      if (!isRecord(body) || typeof body.contractVersion !== 'string' || !Array.isArray(body.capabilities)
        || !body.capabilities.every((c) => typeof c === 'string')) {
        throw new ProbeFailure('invalid_body');
      }
      const capabilities = body.capabilities as string[];
      const inspection = inspectProductContract(product, { contractVersion: body.contractVersion, capabilities });
      if (!inspection.compatible) return { ok: false, reason: 'contract_incompatible', contractVersion: body.contractVersion, inspection };
      return { ok: true, contractVersion: body.contractVersion, inspection };
    },
    () => ({ ok: false }),
  );

  return { productId: product.id, healthy: health.ok && version.ok, health, version };
}
