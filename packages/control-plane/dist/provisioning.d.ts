/** Server-side provisioning; this module MUST NOT be called with unverified browser claims.
 * The caller must validate Logto management credentials, actor authority, and consent.
 * Logto remains authoritative for the existence and membership of its organisations.
 */
import type { ApplicationId, MembershipRole } from './contracts.js';
import type { SqlPool } from './postgres.js';
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
    verifiedAt: string;
};
export interface ProvisioningContext {
    /** Immutable ID from server-validated management credential; NEVER a header supplied by the browser. */
    actorSubject: string;
    /** Caller-supplied evidence reference for verification with source authority; NOT proof on its own. */
    authorityReference: string;
    requestId: string;
}
/** Exactly one transaction and one audit event per idempotency key.
 * Conflicts never mutate another identity's mapping. Replays return the original result.
 */
export declare class CentralProvisioner {
    private readonly pool;
    constructor(pool: SqlPool);
    apply(context: ProvisioningContext, command: ProvisioningCommand): Promise<'created' | 'replayed'>;
}
