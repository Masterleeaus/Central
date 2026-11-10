import type { ApplicationId } from './contracts.js';
import type { ProvisioningCommand, ProvisioningContext } from './provisioning.js';
import type { TrustedActor } from './trusted-provisioning.js';
export declare const ONBOARDING_STATES: readonly ["pending", "verified", "provisioned", "failed"];
export type OnboardingState = (typeof ONBOARDING_STATES)[number];
export declare const ONBOARDING_APPLICATIONS: readonly ["desk", "field", "academy"];
export type CoreFailureCode = 'core_provisioning_failed' | 'product_provisioning_failed';
/** Structured per-product failure. Free text is never stored. `retryable` is true for every code except not_authorised. */
export type ProductFailureCode = 'not_authorised' | 'conflict' | 'account_link_review' | 'provisioning_unavailable';
export declare function canTransition(from: OnboardingState, to: OnboardingState): boolean;
/** Owner identity from the authenticated session. `verified` records that the OIDC layer validated the token. */
export interface OwnerPrincipal {
    readonly logtoSubject: string;
    readonly verified: true;
}
export interface ExistingAccount {
    localUserId: string;
    localAccountId: string;
    assertion: string;
}
/** Only the required business fields. There is deliberately no email, contact or free-text field. */
export interface OnboardingRequest {
    idempotencyKey: string;
    logtoOrganisationId: string;
    organisationName: string;
    products: readonly ApplicationId[];
    existingAccounts?: Partial<Record<ApplicationId, ExistingAccount>>;
}
export interface OnboardingRow {
    id: string;
    idempotencyKey: string;
    organisationId: string;
    logtoOrganisationId: string;
    ownerLogtoSubject: string;
    organisationName: string;
    products: readonly ApplicationId[];
    requestDigest: string;
    state: OnboardingState;
    ownerProofDigest?: string;
    failureCode?: CoreFailureCode;
    rolledBackAt?: string;
    revision: number;
}
export interface ProductRow {
    onboardingId: string;
    organisationId: string;
    application: ApplicationId;
    accountLinkRequired: boolean;
    outcome: 'succeeded' | 'failed';
    failureCode?: ProductFailureCode;
    entitlementId?: string;
    entitlementRequestId?: string;
    linkId?: string;
    linkRequestId?: string;
    attempts: number;
    rolledBackAt?: string;
}
export interface WriteContext {
    actorSubject: string;
    requestId: string;
}
export interface TransitionChange {
    to: OnboardingState;
    failureCode?: CoreFailureCode;
    ownerProofDigest?: string;
    rolledBack?: boolean;
}
/** The only mutation path for product access. Matches TrustedProvisioningService.apply. */
export interface TrustedProvisioningPort {
    apply(actor: TrustedActor, context: ProvisioningContext, command: ProvisioningCommand): Promise<'created' | 'updated' | 'replayed'>;
}
/** Decides whether evidence proves the owner controls ownerSubject now. Returns a SHA-256 hex digest of the
 * evidence, which is what gets stored, or undefined when the proof is not accepted. */
export interface OwnerProofVerifier {
    verify(input: {
        onboardingId: string;
        logtoSubject: string;
        evidence: string;
    }): Promise<string | undefined>;
}
/** Onboarding state access. Every write runs in one transaction that also sets the actor and request for the audit trigger.
 * `insert` throws OnboardingUniqueViolation for any unique key; `transition` throws OnboardingStaleRevision on a lost race. */
export interface OnboardingStore {
    findByKey(idempotencyKey: string): Promise<OnboardingRow | undefined>;
    findById(id: string): Promise<OnboardingRow | undefined>;
    insert(row: OnboardingRow, ctx: WriteContext): Promise<void>;
    transition(input: TransitionChange & {
        id: string;
        expectedRevision: number;
    }, ctx: WriteContext): Promise<OnboardingRow>;
    products(onboardingId: string): Promise<ProductRow[]>;
    saveProduct(row: ProductRow, ctx: WriteContext): Promise<void>;
    identityForSubject(logtoSubject: string): Promise<{
        id: string;
        state: string;
    } | undefined>;
    organisationExists(id: string): Promise<boolean>;
    membershipFor(identityId: string, organisationId: string): Promise<{
        role: string;
        state: string;
    } | undefined>;
    /** Scoped to the organisation: the trusted reader is row-level secured by organisation (migration 0008). */
    entitlement(organisationId: string, id: string): Promise<{
        organisationId: string;
        applicationId: string;
        state: string;
        revision: number;
    } | undefined>;
    link(organisationId: string, id: string): Promise<{
        organisationId: string;
        applicationId: string;
        state: string;
        revision: number;
    } | undefined>;
}
export declare class OnboardingUniqueViolation extends Error {
    constructor();
}
export declare class OnboardingStaleRevision extends Error {
    constructor();
}
export type OnboardingErrorCode = 'invalid_request' | 'unauthenticated' | 'idempotency_conflict' | 'owner_proof_rejected' | 'invalid_state' | 'not_found' | 'rolled_back' | 'stale_revision' | 'duplicate';
export declare class OnboardingError extends Error {
    readonly code: OnboardingErrorCode;
    constructor(code: OnboardingErrorCode, message: string);
}
export interface OnboardingDeps {
    store: OnboardingStore;
    provisioner: TrustedProvisioningPort;
    ownerProof: OwnerProofVerifier;
}
export interface OnboardingView extends OnboardingRow {
    productResults: ProductRow[];
}
/** Deterministic UUID from parts (version 5 bits). The same parts always name the same record. */
export declare function derivedUuid(...parts: string[]): string;
export declare class OnboardingService {
    private readonly deps;
    constructor(deps: OnboardingDeps);
    /** Starts an onboarding. Calling it again with the same key and request returns the same record and writes nothing. */
    start(owner: OwnerPrincipal, input: unknown): Promise<OnboardingRow>;
    /** Records the owner's identity proof. Required before any provisioning. A second proof does not change the record. */
    proveOwner(owner: OwnerPrincipal, onboardingId: string, evidence: string): Promise<OnboardingRow>;
    /** Provisions the organisation, owner membership and each selected product. Safe to call again: completed steps are
     * replayed by the provisioner, and products that already succeeded are not granted again. A failed onboarding is resumed.
     * The request must be supplied again: its digest is checked, and the assertions are verified at each call. */
    provision(operator: TrustedActor, input: unknown): Promise<OnboardingRow>;
    /** Revokes what this onboarding granted and marks it rolled back. Only a failed onboarding can be rolled back, and it cannot resume after. */
    rollback(operator: TrustedActor, onboardingId: string): Promise<OnboardingRow>;
    /** Progress for the owner. Another owner gets the same error as a missing record. */
    progressForOwner(owner: OwnerPrincipal, onboardingId: string): Promise<OnboardingView>;
    /** Progress for a tenant. A record of another organisation gets the same error as a missing record. */
    progressForOrganisation(organisationId: string, onboardingId: string): Promise<OnboardingView>;
    private requireById;
    private requireByKey;
    private requireOwned;
    private transition;
    private apply;
    /** Identity, organisation and owner membership. Returns undefined when a step cannot be completed safely. */
    private ensureCore;
    private provisionProduct;
}
