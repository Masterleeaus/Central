/** Canonical subscription state model and its mapping to entitlements (issue #35).
 * Pure functions: no I/O and no clock. See docs/SUBSCRIPTIONS.md for the full rules and open decisions.
 */
import type { ApplicationId } from './contracts.js';
import type { GrantState } from './postgres.js';
import { resolveGrants, type PlanCatalogue } from './plan-catalogue.js';

export const SUBSCRIPTION_STATES = ['trial', 'active', 'grace', 'cancelled', 'refunded', 'expired'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export function isSubscriptionState(value: unknown): value is SubscriptionState {
  return typeof value === 'string' && (SUBSCRIPTION_STATES as readonly string[]).includes(value);
}

/** Allowed transitions. A self-transition is a renewal or a date update, not a state change.
 * `refunded` and `expired` are terminal: no later event can move a subscription back to an access state.
 * Starting a new paid period after expiry is a new subscription id. */
export const SUBSCRIPTION_TRANSITIONS: Readonly<Record<SubscriptionState, readonly SubscriptionState[]>> = Object.freeze({
  trial: ['trial', 'active', 'grace', 'cancelled', 'refunded', 'expired'],
  active: ['active', 'grace', 'cancelled', 'refunded', 'expired'],
  grace: ['grace', 'active', 'cancelled', 'refunded', 'expired'],
  cancelled: ['cancelled', 'active', 'refunded', 'expired'],
  refunded: ['refunded'],
  expired: ['expired'],
});

/** A subscription with no recorded state may start only in these states. */
export const INITIAL_SUBSCRIPTION_STATES: readonly SubscriptionState[] = Object.freeze(['trial', 'active']);

export function isAllowedTransition(from: SubscriptionState | undefined, to: SubscriptionState): boolean {
  if (from === undefined) return INITIAL_SUBSCRIPTION_STATES.includes(to);
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

/** Normalised provider snapshot after the adapter has parsed one event. Dates are ISO 8601 UTC strings. */
export interface SubscriptionSnapshot {
  readonly state: SubscriptionState;
  readonly planId: string;
  readonly addOnIds: readonly string[];
  /** Required in `trial`: the trial access end. */
  readonly trialEndsAt?: string;
  /** Required in `active`: the end of the paid period, so renewal moves it forward. */
  readonly periodEndsAt?: string;
  /** Required in `grace`: the end of the grace window. TO DECIDE: its length is a policy decision. */
  readonly graceEndsAt?: string;
  /** Used in `cancelled`: the paid access end. Absent means access ends now (TO DECIDE, see docs). */
  readonly accessEndsAt?: string;
}

export interface EntitlementChange {
  readonly applicationId: ApplicationId;
  readonly state: GrantState;
  readonly features: readonly string[];
  readonly expiresAt: string | null;
}

export class SubscriptionMappingError extends Error {
  constructor(message: string) { super(message); this.name = 'SubscriptionMappingError'; }
}

export const APPLICATION_IDS: readonly ApplicationId[] = Object.freeze(['field', 'desk', 'academy'] as ApplicationId[]);

/** Access states grant features while the expiry allows. Anything else grants nothing. */
const ACCESS_GRANT_STATES: ReadonlySet<GrantState> = new Set<GrantState>(['active', 'trialing']);
export function isAccessGrantState(state: GrantState): boolean { return ACCESS_GRANT_STATES.has(state); }

function required(snapshot: SubscriptionSnapshot, field: 'trialEndsAt' | 'periodEndsAt' | 'graceEndsAt'): string {
  const value = snapshot[field];
  if (!value) throw new SubscriptionMappingError(`${snapshot.state} requires ${field}`);
  return value;
}

/** Deterministic mapping from one subscription snapshot to one entitlement change per application.
 *  - trial     -> trialing until trialEndsAt
 *  - active    -> active until periodEndsAt
 *  - grace     -> active until graceEndsAt (payment failed; access continues only for the grace window)
 *  - cancelled -> active until accessEndsAt when given; otherwise revoked now (TO DECIDE)
 *  - refunded  -> revoked, no features
 *  - expired   -> expired, no features
 * An application that the plan and add-ons do not cover is always revoked with no features.
 * Throws SubscriptionMappingError or CatalogueError; the caller must treat both as a rejected event. */
export function mapSubscriptionToEntitlements(snapshot: SubscriptionSnapshot, catalogue: PlanCatalogue): readonly EntitlementChange[] {
  const grants = resolveGrants(catalogue, snapshot.planId, snapshot.addOnIds);
  let access: { state: GrantState; expiresAt: string | null; granting: boolean };
  switch (snapshot.state) {
    case 'trial': access = { state: 'trialing', expiresAt: required(snapshot, 'trialEndsAt'), granting: true }; break;
    case 'active': access = { state: 'active', expiresAt: required(snapshot, 'periodEndsAt'), granting: true }; break;
    case 'grace': access = { state: 'active', expiresAt: required(snapshot, 'graceEndsAt'), granting: true }; break;
    case 'cancelled':
      access = snapshot.accessEndsAt
        ? { state: 'active', expiresAt: snapshot.accessEndsAt, granting: true }
        : { state: 'revoked', expiresAt: null, granting: false };
      break;
    case 'refunded': access = { state: 'revoked', expiresAt: null, granting: false }; break;
    case 'expired': access = { state: 'expired', expiresAt: null, granting: false }; break;
    default: throw new SubscriptionMappingError('unknown subscription state');
  }
  return APPLICATION_IDS.map((applicationId): EntitlementChange => {
    const features = grants.get(applicationId);
    if (features && features.length > 0 && access.granting) {
      return { applicationId, state: access.state, features: [...features], expiresAt: access.expiresAt };
    }
    return { applicationId, state: features ? access.state : 'revoked', features: [], expiresAt: null };
  });
}
