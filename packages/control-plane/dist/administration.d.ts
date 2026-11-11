/** Organisation administration: the operator read model and the tenant-administrator authority policy.
 * Reads run through withTenantReadScope (titan_trusted_reader, one organisation per snapshot, RLS from 0006/0008).
 * Tenant mutations are NOT executed here. This module only decides whether a tenant administrator may
 * perform a membership command; the command itself runs through TrustedProvisioningService and CentralProvisioner,
 * which apply the expected revision, the session revocation generation and the audit row in one transaction.
 */
import type { MembershipRole } from './contracts.js';
import type { SqlPool, MemberState } from './postgres.js';
import type { AuthorizeProvisioning, GetCanonicalLogtoId } from './trusted-provisioning.js';
import { type LogtoManagementVerifier } from './logto-management.js';
/** Higher is more privileged. A tenant administrator may only assign or change roles strictly below their own. */
export declare const ROLE_RANK: Readonly<Record<MembershipRole, number>>;
export interface OrganisationAccess {
    organisation: {
        id: string;
        logtoOrganisationId: string;
        state: string;
    };
    memberships: Array<{
        id: string;
        identityId: string;
        logtoSubject: string;
        role: string;
        state: string;
        expiresAt?: string;
        revision: number;
    }>;
    entitlements: Array<{
        id: string;
        applicationId: string;
        state: string;
        features: string[];
        expiresAt?: string;
        revision: number;
    }>;
    links: Array<{
        id: string;
        identityId: string;
        applicationId: string;
        localUserId: string;
        localAccountId: string;
        state: string;
        verifiedAt?: string;
        revision: number;
    }>;
}
/** Operator read: one organisation per call. Returns undefined when the organisation does not exist. */
export declare function readOrganisationAccess(pool: SqlPool, organisationId: string): Promise<OrganisationAccess | undefined>;
export interface ActorMembership {
    id: string;
    identityId: string;
    role: MembershipRole;
}
export interface TargetMembership {
    id: string;
    identityId: string;
    logtoSubject: string;
    role: MembershipRole;
    state: MemberState;
    revision: number;
}
/** Reads used by the tenant policy. Every read is scoped to one organisation, so another tenant's rows are invisible. */
export interface TenantAdministrationStore {
    actorMembership(logtoSubject: string, organisationId: string): Promise<ActorMembership | undefined>;
    membership(membershipId: string, organisationId: string): Promise<TargetMembership | undefined>;
}
export declare function createPostgresTenantAdministrationStore(pool: SqlPool): TenantAdministrationStore;
/** Delegation rule: a tenant administrator may assign only roles strictly below their own, never owner. */
export declare function canDelegateRole(actorRole: MembershipRole, targetRole: MembershipRole): boolean;
export interface TenantAdministrationOptions {
    verifier: LogtoManagementVerifier;
    resolve: GetCanonicalLogtoId;
    store: TenantAdministrationStore;
    /** Logto organisation role IDs that mark a tenant administrator. Provisioned by a trusted operator. */
    administrativeRoleIds: readonly string[];
}
/** Authority for tenant administrators. Allows only membership and membership_update, only for the command's
 * organisation, only for owners and administrators of that organisation, and only within the delegation rule.
 * Fails closed: any refusal, unknown target, other tenant's row or self-change returns false.
 * Checks, in order: trusted actor; command kind; Titan membership and role; target row in the same organisation;
 * delegation; then live Logto membership and administrator role. Logto infrastructure failures reject. */
export declare function createTenantAdministrationAuthorizer(opts: TenantAdministrationOptions): AuthorizeProvisioning;
