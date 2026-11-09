/** Explicit authority gate for Titan Central provisioning.
 * This service is only for an authenticated backend. Caller MUST pass a trusted actor
 * (verified server-side, never from JSON body), and an independently implemented policy.
 */
import type { ProvisioningCommand, ProvisioningContext } from './provisioning.js';
import { CentralProvisioner } from './provisioning.js';
import { LogtoManagementVerifier } from './logto-management.js';
/** `operatorAuthorityVerified` records that the caller's Logto organisation authority was checked against the
 * Management API for this request. It is NOT evidence that an end-user bearer token is a machine credential. */
export type TrustedActor = {
    logtoSubject: string;
    operatorAuthorityVerified: true;
};
export type AuthorizeProvisioning = (actor: TrustedActor, command: ProvisioningCommand) => Promise<boolean>;
/** Verifies the product-signed assertion carried by a link command against the Central identity and organisation.
 * `logtoSubject` and `logtoOrganisationId` are resolved by Central, never taken from the command. */
export interface LinkCheckInput {
    command: Extract<ProvisioningCommand, {
        kind: 'link' | 'link_relink';
    }>;
    logtoSubject: string;
    logtoOrganisationId: string;
}
export type VerifyLocalLink = (input: LinkCheckInput) => Promise<boolean>;
export type GetCanonicalLogtoId = (type: 'identity' | 'organisation', uuid: string) => Promise<string | undefined>;
/** Thrown when the authorisation policy refuses a command. Carries no detail beyond the refusal. */
export declare class ProvisioningForbiddenError extends Error {
    constructor();
}
export declare class TrustedProvisioningService {
    private readonly provisioner;
    private readonly logto;
    private readonly authorize;
    private readonly resolve;
    private readonly verifyLocalLink;
    constructor(provisioner: CentralProvisioner, logto: LogtoManagementVerifier, authorize: AuthorizeProvisioning, resolve: GetCanonicalLogtoId, verifyLocalLink: VerifyLocalLink);
    apply(actor: TrustedActor, context: ProvisioningContext, command: ProvisioningCommand): Promise<'created' | 'updated' | 'replayed'>;
}
