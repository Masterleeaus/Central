// TEST ONLY. A fake billing provider. Its secret is a fixture, never a real credential.
import { verifyWebhookSignature, signWebhookPayload, AdapterParseError } from '../../dist/index.js';
export const FAKE_PROVIDER = 'fake-billing';
export const FAKE_SECRET = 'fixture-secret-only-for-tests-0123456789';
export const SIGNATURE_HEADER = 'x-fake-signature';
const STATES = new Set(['trial', 'active', 'grace', 'cancelled', 'refunded', 'expired']);

export function fakeAdapter() {
  return {
    name: FAKE_PROVIDER,
    verify(request, secret, now) {
      return verifyWebhookSignature({ rawBody: request.rawBody, signatureHeader: request.headers[SIGNATURE_HEADER], secret, now });
    },
    parse(rawBody) {
      const b = JSON.parse(rawBody);
      if (typeof b.id !== 'string' || typeof b.subscription !== 'string' || typeof b.organisation !== 'string') throw new AdapterParseError('missing identifiers');
      if (!STATES.has(b.state)) throw new AdapterParseError('unknown state');
      const iso = (v) => (v === undefined ? undefined : new Date(v).toISOString());
      const occurredAt = new Date(b.occurred);
      if (!Number.isFinite(occurredAt.valueOf())) throw new AdapterParseError('bad occurred');
      return {
        provider: FAKE_PROVIDER,
        providerEventId: b.id,
        subscriptionId: b.subscription,
        organisationId: b.organisation,
        occurredAt: occurredAt.toISOString(),
        snapshot: {
          state: b.state, planId: b.plan, addOnIds: b.addOns ?? [],
          trialEndsAt: iso(b.trialEndsAt), periodEndsAt: iso(b.periodEndsAt), graceEndsAt: iso(b.graceEndsAt), accessEndsAt: iso(b.accessEndsAt),
        },
      };
    },
  };
}

/** Builds a signed delivery for a fake event body. `at` is the signing time (seconds). */
export function deliver(body, { at = Math.floor(Date.now() / 1000), secret = FAKE_SECRET } = {}) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  return { rawBody, headers: { [SIGNATURE_HEADER]: signWebhookPayload(rawBody, at, secret) } };
}
