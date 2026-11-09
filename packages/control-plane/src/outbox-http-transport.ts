import { OutboxError, assertTenantId, redactError } from './outbox.js';
import type { OutboxEnvelope, PublishTarget, PublishTransport } from './outbox-publisher.js';

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

export const TRANSPORT_DEFAULT_TIMEOUT_MS = 10_000;
export const TRANSPORT_MAX_TIMEOUT_MS = 60_000;
export const TRANSPORT_MAX_BODY_BYTES = 16 * 1024;

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
export function assertConsumerEndpoint(consumer: string, value: unknown, allowInsecureLocalhost: boolean): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new OutboxError('insecure_endpoint', `endpoint for ${consumer} is missing or too long`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboxError('insecure_endpoint', `endpoint for ${consumer} is not a valid URL`);
  }
  const secure = url.protocol === 'https:' || (allowInsecureLocalhost === true && url.protocol === 'http:' && url.hostname === 'localhost');
  if (!secure) throw new OutboxError('insecure_endpoint', `endpoint for ${consumer} must use https`);
  if (url.username || url.password || url.search || url.hash) {
    throw new OutboxError('insecure_endpoint', `endpoint for ${consumer} must not carry credentials, a query or a fragment`);
  }
  return url.toString();
}

export function createHttpPublishTransport(options: HttpTransportOptions): PublishTransport {
  const fetchImpl: HttpFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? TRANSPORT_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TRANSPORT_MAX_TIMEOUT_MS) {
    throw new OutboxError('invalid_field', 'transport timeout out of range');
  }
  const allow = options.allowInsecureLocalhost === true;
  const urls = new Map<string, string>();
  for (const endpoint of options.endpoints) {
    if (urls.has(endpoint.consumer)) throw new OutboxError('invalid_field', `more than one endpoint for ${endpoint.consumer}`);
    urls.set(endpoint.consumer, assertConsumerEndpoint(endpoint.consumer, endpoint.url, allow));
  }

  return {
    async send(envelope: OutboxEnvelope, target: PublishTarget): Promise<void> {
      const url = urls.get(target.consumer);
      if (url === undefined) throw new OutboxError('route_mismatch', `no endpoint for consumer ${target.consumer}`);
      // Defence in depth: the envelope must belong to the tenant this consumer is bound to.
      if (assertTenantId(envelope.organisationId) !== assertTenantId(target.organisationId)) {
        throw new OutboxError('route_mismatch', `consumer ${target.consumer} is not bound to this tenant`);
      }
      const body = JSON.stringify(envelope);
      if (Buffer.byteLength(body, 'utf8') > TRANSPORT_MAX_BODY_BYTES) {
        throw new OutboxError('payload_too_large', 'envelope exceeds the transport body limit');
      }

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'content-type': 'application/json' },
          body,
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'Error';
        throw new OutboxError('transport_failed', `request to ${target.consumer} failed (${redactError(name)})`);
      }
      // The answer body is not read. Dropping it releases the connection.
      try { await response.body?.cancel(); } catch { /* nothing to release */ }
      if (response.status < 200 || response.status > 299) {
        throw new OutboxError('transport_failed', `consumer ${target.consumer} answered HTTP ${response.status}`);
      }
    },
  };
}
