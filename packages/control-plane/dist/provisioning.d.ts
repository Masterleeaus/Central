import type { ApplicationId, MembershipRole } from './contracts.js';
import type { SqlPool, MemberState, GrantState } from './postgres.js';
export type ProvisioningCommand = {
    kind: 'identity';
    id: string;
    logtoSubject: string;
} | {
    kind: 'organisation';
    id: string;
    logtoOrganisationId: string;
} | {
    kind: 'membership';
    id: string;
    identityId: string;
    organisationId: string;
    role: MembershipRole;
} | {
    kind: 'entitlement';
    id: string;
    organisationId: string;
    applicationId: ApplicationId;
    features: readonly string[];
    expiresAt?: string;
} | {
    kind: 'link';
    id: string;
    identityId: string;
    organisationId: string;
    applicationId: ApplicationId;
    localUserId: string;
    localAccountId: string;
    assertion: string;
} | {
    kind: 'link_relink';
    id: string;
    identityId: string;
    organisationId: string;
    applicationId: ApplicationId;
    expectedRevision: number;
    localUserId: string;
    localAccountId: string;
    assertion: string;
} | {
    kind: 'membership_update';
    id: string;
    organisationId: string;
    expectedRevision: number;
    role?: MembershipRole;
    state?: MemberState;
} | {
    kind: 'entitlement_update';
    id: string;
    organisationId: string;
    expectedRevision: number;
    state: GrantState;
} | {
    kind: 'link_revoke';
    id: string;
    organisationId: string;
    expectedRevision: number;
};
/** Why an account link was not written and was recorded for review instead. Fail closed; nothing is auto-resolved. */
export type LinkReviewReason = 'existing_link_other_account' | 'account_claimed_elsewhere' | 'concurrent_conflict';
/** Thrown after the review row and its audit row have committed. The link itself was NOT written. */
export declare class LinkReviewRequired extends Error {
    readonly reason: LinkReviewReason;
    readonly reviewId: string;
    constructor(reason: LinkReviewReason, reviewId: string);
}
export interface ProvisioningContext {
    /** Immutable ID from server-validated management credential; NEVER a header supplied by the browser. */
    actorSubject: string;
    /** Caller-supplied evidence reference for verification with source authority; NOT proof on its own. */
    authorityReference: string;
    requestId: string;
}
/** Exactly one transaction and one audit event per idempotency key.
 * Conflicts never mutate another identity's mapping. Replays return the original result.
 * Reductions of access (suspend, demote, revoke, unlink, relink) bump the session revocation generation
 * in the same transaction as the row change and the audit record.
 * Ambiguous account-link cases commit a review row and an audit row, change no link, and throw LinkReviewRequired.
 */
export declare class CentralProvisioner {
    private readonly pool;
    constructor(pool: SqlPool);
    apply(context: ProvisioningContext, command: ProvisioningCommand): Promise<'created' | 'updated' | 'replayed'>;
}
