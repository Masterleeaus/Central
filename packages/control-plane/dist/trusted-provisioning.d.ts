/** Explicit authority gate for Titan Central provisioning.
 * This service is only for an authenticated backend. Caller MUST pass a trusted actor
 * (verified server-side, never from JSON body), and an independently implemented policy.
 */
import type { ProvisioningCommand, ProvisioningContext } from './provisioning.js';
import { CentralProvisioner } from './provisioning.js';
import { LogtoManagementVerifier } from './logto-management.js';
/** `managementCredentialVerified` records that the caller's Logto organisation authority was checked against the
 * Management API for this request. It is NOT evidence that an end-user bearer token is a machine credential. */
export type TrustedActor = {
    logtoSubject: string;
    managementCredentialVerified: true;
};
export type AuthorizeProvisioning = (actor: TrustedActor, command: ProvisioningCommand) => Promise<boolean>;
export type VerifyLocalLink = (command: Extract<ProvisioningCommand, {
    kind: 'link';
}>) => Promise<boolean>;
export type GetCanonicalLogtoId = (type: 'identity' | 'organisation', uuid: string) => Promise<string | undefined>;
export declare class TrustedProvisioningService {
    private readonly provisioner;
    private readonly logto;
    private readonly authorize;
    private readonly resolve;
    private readonly verifyLocalLink;
    constructor(provisioner: CentralProvisioner, logto: LogtoManagementVerifier, authorize: AuthorizeProvisioning, resolve: GetCanonicalLogtoId, verifyLocalLink: VerifyLocalLink);
    apply(actor: TrustedActor, context: ProvisioningContext, command: ProvisioningCommand): Promise<'created' | 'replayed'>;
}
