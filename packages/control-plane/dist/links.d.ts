import type { ApplicationId, LocalAccountLink } from './contracts.js';
/** A link is an independently verified assertion from the destination application, not email matching. */
export interface VerifiedLinkAssertion {
    identityId: string;
    organisationId: string;
    applicationId: ApplicationId;
    localUserId: string;
    localAccountId: string;
    assertedAt: string;
    verifiedBy: string;
}
export declare function linkFromVerifiedAssertion(id: string, assertion: VerifiedLinkAssertion, now: string): LocalAccountLink;
