/** Canonical subscription state model and its mapping to entitlements (issue #35).
 * Pure functions: no I/O and no clock. See docs/SUBSCRIPTIONS.md for the full rules and open decisions.
 */
import type { ApplicationId } from './contracts.js';
import type { GrantState } from './postgres.js';
import { type PlanCatalogue } from './plan-catalogue.js';
export declare const SUBSCRIPTION_STATES: readonly ["trial", "active", "grace", "cancelled", "refunded", "expired"];
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];
export declare function isSubscriptionState(value: unknown): value is SubscriptionState;
/** Allowed transitions. A self-transition is a renewal or a date update, not a state change.
 * `refunded` and `expired` are terminal: no later event can move a subscription back to an access state.
 * Starting a new paid period after expiry is a new subscription id. */
export declare const SUBSCRIPTION_TRANSITIONS: Readonly<Record<SubscriptionState, readonly SubscriptionState[]>>;
/** A subscription with no recorded state may start only in these states. */
export declare const INITIAL_SUBSCRIPTION_STATES: readonly SubscriptionState[];
export declare function isAllowedTransition(from: SubscriptionState | undefined, to: SubscriptionState): boolean;
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
export declare class SubscriptionMappingError extends Error {
    constructor(message: string);
}
export declare const APPLICATION_IDS: readonly ApplicationId[];
export declare function isAccessGrantState(state: GrantState): boolean;
/** Deterministic mapping from one subscription snapshot to one entitlement change per application.
 *  - trial     -> trialing until trialEndsAt
 *  - active    -> active until periodEndsAt
 *  - grace     -> active until graceEndsAt (payment failed; access continues only for the grace window)
 *  - cancelled -> active until accessEndsAt when given; otherwise revoked now (TO DECIDE)
 *  - refunded  -> revoked, no features
 *  - expired   -> expired, no features
 * An application that the plan and add-ons do not cover is always revoked with no features.
 * Throws SubscriptionMappingError or CatalogueError; the caller must treat both as a rejected event. */
export declare function mapSubscriptionToEntitlements(snapshot: SubscriptionSnapshot, catalogue: PlanCatalogue): readonly EntitlementChange[];
