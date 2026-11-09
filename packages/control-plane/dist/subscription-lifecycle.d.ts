import type { ApplicationId } from './contracts.js';
import type { GrantState } from './postgres.js';
import type { ProvisioningCommand, ProvisioningContext } from './provisioning.js';
import { type PlanCatalogue } from './plan-catalogue.js';
import { type SubscriptionState } from './subscription-model.js';
import type { BillingProviderAdapter, ProviderRequest } from './billing-adapter.js';
import type { WebhookRejectCode } from './webhook-verifier.js';
export type LedgerDisposition = 'pending' | 'applied' | 'ignored_out_of_order' | 'rejected_transition' | 'rejected_invalid' | 'rejected_organisation';
export interface SubscriptionRecord {
    organisationId: string;
    state: SubscriptionState;
    positionAt: string;
    positionEventId: string;
}
export interface LedgerEventKey {
    provider: string;
    providerEventId: string;
    subscriptionId: string;
    occurredAt: string;
}
export interface LedgerTx {
    /** Records the event as pending unless it already exists. */
    beginEvent(event: LedgerEventKey): Promise<{
        kind: 'new';
    } | {
        kind: 'existing';
        disposition: LedgerDisposition;
    }>;
    subscription(provider: string, subscriptionId: string): Promise<SubscriptionRecord | undefined>;
    /** Sets the last applied position. Called only after the entitlement writes for the event succeeded. */
    advance(provider: string, subscriptionId: string, record: SubscriptionRecord): Promise<void>;
    finish(provider: string, providerEventId: string, disposition: Exclude<LedgerDisposition, 'pending'>, detail: {
        reason: string;
        requestIds: readonly string[];
    }): Promise<void>;
}
export interface BillingLedger {
    withSubscriptionLock<T>(provider: string, subscriptionId: string, task: (tx: LedgerTx) => Promise<T>): Promise<T>;
}
export interface EntitlementRow {
    id: string;
    revision: number;
    state: GrantState;
    features: readonly string[];
    expiresAt: string | null;
}
export interface EntitlementReader {
    entitlement(organisationId: string, applicationId: ApplicationId): Promise<EntitlementRow | undefined>;
}
/** The trusted provisioning mutation path. CentralProvisioner satisfies this; the caller may wrap it in an authority gate. */
export interface ProvisioningPort {
    apply(context: ProvisioningContext, command: ProvisioningCommand): Promise<unknown>;
}
export type LifecycleRejectCode = WebhookRejectCode | 'invalid_payload' | 'transition_not_allowed' | 'organisation_mismatch' | 'mapping_invalid';
export type LifecycleOutcome = {
    status: 'applied';
    mutations: number;
} | {
    status: 'duplicate';
} | {
    status: 'ignored';
    reason: 'out_of_order';
} | {
    status: 'rejected';
    code: LifecycleRejectCode;
    reason?: string;
};
export interface LifecycleOptions {
    adapter: BillingProviderAdapter;
    /** Webhook signing secret, from the caller's secret store. */
    secret: string;
    ledger: BillingLedger;
    entitlements: EntitlementReader;
    provisioning: ProvisioningPort;
    catalogue: PlanCatalogue;
    clock?: () => Date;
}
/** Deterministic UUID (version 5 layout) from the given parts. Used for request ids and entitlement ids, so a
 * replayed event produces the same request id and is recognised by the provisioning audit table. */
export declare function deriveUuid(...parts: readonly string[]): string;
export declare class SubscriptionLifecycle {
    private readonly options;
    constructor(options: LifecycleOptions);
    handle(request: ProviderRequest): Promise<LifecycleOutcome>;
    private process;
    /** Writes one application's change through the provisioning port. Returns the request ids it used. */
    private applyChange;
    private context;
    private finish;
}
