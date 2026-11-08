import type { AuthorizeProvisioning, GetCanonicalLogtoId } from './trusted-provisioning.js';
import { LogtoManagementVerifier } from './logto-management.js';
export interface OrganisationAuthorityOptions {
    verifier: LogtoManagementVerifier;
    resolve: GetCanonicalLogtoId;
    /** Exact IDs of Logto organization roles authorised to administer Titan membership/entitlements. */
    administrativeRoleIds: readonly string[];
}
export declare function createOrganisationProvisioningAuthorizer(opts: OrganisationAuthorityOptions): AuthorizeProvisioning;
