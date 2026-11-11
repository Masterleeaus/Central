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
export declare const PROBE_PATHS: Readonly<{
    health: "/titan/v1/health";
    version: "/titan/v1/version";
}>;
export declare const DEFAULT_PROBE_TIMEOUT_MS = 2000;
export declare const DEFAULT_PROBE_MAX_BODY_BYTES = 4096;
export interface ProbeReaderChunk {
    done: boolean;
    value?: Uint8Array;
}
export interface ProbeBodyReader {
    read(): Promise<ProbeReaderChunk>;
    cancel(reason?: unknown): Promise<unknown>;
}
export interface ProbeResponse {
    status: number;
    body: {
        getReader(): ProbeBodyReader;
    } | null;
}
export interface ProbeRequestInit {
    method: 'GET';
    redirect: 'manual';
    signal: AbortSignal;
    headers: Readonly<Record<string, string>>;
}
export type ProbeFetch = (url: string, init: ProbeRequestInit) => Promise<ProbeResponse>;
export type ProbeReason = 'not_configured' | 'timeout' | 'network_error' | 'redirect' | 'http_status' | 'body_too_large' | 'invalid_body' | 'health_not_ok' | 'contract_incompatible';
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
/**
 * Probes one registered product. Never throws: every failure is returned as unhealthy with a reason.
 * A product with no validated origin is not fetched.
 */
export declare function probeProduct(product: RegisteredProduct, options: ProbeOptions): Promise<ProductProbeResult>;
