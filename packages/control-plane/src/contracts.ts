/** Titan-owned contracts. Logto remains authoritative for identity and OIDC authentication. */
export type ApplicationId = 'field' | 'desk' | 'academy';
export type IdentityId = string;
export type OrganisationId = string;
export type MembershipRole = 'owner' | 'admin' | 'manager' | 'member' | 'learner';
export type MembershipStatus = 'active' | 'invited' | 'suspended' | 'revoked';
export type EntitlementStatus = 'active' | 'trialing' | 'paused' | 'expired' | 'revoked';

export interface Identity { id: IdentityId; logtoSubject: string; status: 'active' | 'blocked'; }
export interface Organisation { id: OrganisationId; logtoOrganisationId: string; status: 'active' | 'suspended'; }
export interface Membership { id: string; identityId: IdentityId; organisationId: OrganisationId; role: MembershipRole; status: MembershipStatus; expiresAt?: string; revision: number; }
export interface AppEntitlement { id: string; organisationId: OrganisationId; applicationId: ApplicationId; status: EntitlementStatus; features: readonly string[]; expiresAt?: string; revision: number; }
export interface LocalAccountLink { id: string; identityId: IdentityId; organisationId: OrganisationId; applicationId: ApplicationId; localUserId: string; localAccountId: string; status: 'verified' | 'revoked'; verifiedAt: string; revision: number; }

/** This is accepted only after an OIDC middleware has cryptographically validated token signature,
 * issuer, audience, expiration, state and nonce (as applicable). This library DOES NOT verify tokens. */
export interface VerifiedPrincipal { logtoSubject: string; issuer: string; audience: string; verifiedAt: string; }
export interface AccessRequest { principal: VerifiedPrincipal; organisationId: OrganisationId; applicationId: ApplicationId; action: string; now?: string; }
export type AccessDecision = { allowed: true; identityId: string; organisationId: string; applicationId: ApplicationId; localUserId: string; localAccountId: string; role: MembershipRole; membershipRevision: number; entitlementRevision: number; linkRevision: number; } | { allowed: false; reason: DenialReason };
export type DenialReason = 'untrusted_issuer' | 'untrusted_audience' | 'invalid_principal' | 'identity_inactive' | 'organisation_inactive' | 'membership_missing' | 'membership_inactive' | 'membership_expired' | 'entitlement_missing' | 'entitlement_inactive' | 'entitlement_expired' | 'feature_denied' | 'role_denied' | 'link_missing' | 'link_unverified' | 'link_ambiguous';
export interface CentralRepository {
  identityBySubject(subject: string): Promise<Identity | undefined>;
  organisation(id: string): Promise<Organisation | undefined>;
  memberships(identityId: string, organisationId: string): Promise<readonly Membership[]>;
  entitlements(organisationId: string, applicationId: ApplicationId): Promise<readonly AppEntitlement[]>;
  localLinks(identityId: string, organisationId: string, applicationId: ApplicationId): Promise<readonly LocalAccountLink[]>;
}
