import type { PublishTransport } from './outbox-publisher.js';
/** HTTP transport for the publisher. POSTs the signed envelope as JSON to one configured URL per consumer.
 *
 * - https only. http is accepted only for localhost, and only when allowInsecureLocalhost is set (the caller
 *   passes the TITAN_ALLOW_INSECURE_LOCALHOST=1 policy). URLs with credentials, a query or a fragment are refused.
 * - Redirects are never followed (fetch redirect: 'error'). A 3xx or any non-2xx answer is a failed attempt.
 * - Every request has a timeout (AbortSignal). The request body is bounded before sending.
 * - The envelope's own signature is the authentication (see outbox-keys.ts). This transport adds no other header.
 * - Errors name the consumer and the failure class. They never include the URL, the body or a secret.
 *
 * fetch is injected so tests run without a network. The default is the global fetch. */
export declare const TRANSPORT_DEFAULT_TIMEOUT_MS = 10000;
export declare const TRANSPORT_MAX_TIMEOUT_MS = 60000;
export declare const TRANSPORT_MAX_BODY_BYTES: number;
export interface ConsumerEndpoint {
    readonly consumer: string;
    readonly url: string;
}
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface HttpTransportOptions {
    readonly endpoints: readonly ConsumerEndpoint[];
    readonly fetch?: HttpFetch;
    readonly timeoutMs?: number;
    readonly allowInsecureLocalhost?: boolean;
}
/** Validates one endpoint URL and returns its normalised form. Throws OutboxError; the message never echoes the URL. */
export declare function assertConsumerEndpoint(consumer: string, value: unknown, allowInsecureLocalhost: boolean): string;
export declare function createHttpPublishTransport(options: HttpTransportOptions): PublishTransport;
