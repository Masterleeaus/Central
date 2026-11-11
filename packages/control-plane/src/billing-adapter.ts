/** Provider-agnostic billing adapter boundary (issue #35). An adapter is the only code that knows a provider's
 * payload format. It verifies a delivery and turns it into a ProviderEvent. It never receives or stores card
 * data, bank details or provider API keys: the event carries only the subscription state and identifiers.
 */
import type { SubscriptionSnapshot } from './subscription-model.js';
import type { WebhookVerification } from './webhook-verifier.js';

export interface ProviderRequest {
  /** Exact bytes received. Signatures are checked over these bytes, before any JSON parsing. */
  readonly rawBody: string;
  /** Lower-case header names. */
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface ProviderEvent {
  readonly provider: string;
  /** The provider's unique event id. Used for dedupe, and kept as the tie-break in ordering. */
  readonly providerEventId: string;
  readonly subscriptionId: string;
  /** Our organisation id, copied from the checkout metadata that the provider signed. */
  readonly organisationId: string;
  /** When the provider says the change happened (ISO 8601). Used for ordering, not the delivery time. */
  readonly occurredAt: string;
  readonly snapshot: SubscriptionSnapshot;
}

export class AdapterParseError extends Error {
  constructor(message: string) { super(message); this.name = 'AdapterParseError'; }
}

export interface BillingProviderAdapter {
  /** Stable provider name, stored with every event. */
  readonly name: string;
  /** Verifies the delivery. The secret is owned by the caller and passed per call. */
  verify(request: ProviderRequest, secret: string, now: Date): WebhookVerification;
  /** Parses a verified body. Throws AdapterParseError for any shape it does not recognise. */
  parse(rawBody: string): ProviderEvent;
}
