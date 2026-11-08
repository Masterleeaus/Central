/** Server-only authority policy. Caller supplies subject from a verified OIDC token,
 * never from request JSON. Authoritative roles are fetched from Logto on each check.
 * Role identifiers must be provisioned independently by a trusted operator.
 */
import type {ProvisioningCommand} from './provisioning.js';
import type {AuthorizeProvisioning,TrustedActor,GetCanonicalLogtoId} from './trusted-provisioning.js';
import {LogtoManagementVerifier,LogtoAuthorityError} from './logto-management.js';

const validId=(value:unknown):value is string => typeof value==='string' && value.length>0 && value.length<=256 && /^[A-Za-z0-9_-]+$/.test(value);
export interface OrganisationAuthorityOptions {
  verifier:LogtoManagementVerifier;
  resolve:GetCanonicalLogtoId;
  /** Exact IDs of Logto organization roles authorised to administer Titan membership/entitlements. */
  administrativeRoleIds:readonly string[];
}
export function createOrganisationProvisioningAuthorizer(opts:OrganisationAuthorityOptions):AuthorizeProvisioning {
  const roles=opts.administrativeRoleIds;
  if(!Array.isArray(roles)||roles.length===0||roles.length>32||roles.some(id=>!validId(id))||new Set(roles).size!==roles.length)
    throw new Error('explicit Logto administrator role IDs are required');
  return async (actor:TrustedActor, command:ProvisioningCommand):Promise<boolean>=>{
    if(!validId(actor?.logtoSubject)||actor.operatorAuthorityVerified!==true) return false;
    // Creating canonical user/org identities requires a separate platform provisioning authority.
    // It must never be granted implicitly merely because someone is an org administrator.
    if(command.kind==='identity'||command.kind==='organisation') return false;
    const organisationId=await opts.resolve('organisation',command.organisationId);
    if(!validId(organisationId)) return false;
    try {
      await opts.verifier.assertMembership(actor.logtoSubject,organisationId);
      await opts.verifier.assertAnyOrganisationRole(actor.logtoSubject,organisationId,roles);
      return true;
    } catch(e) {
      if(e instanceof LogtoAuthorityError) return false;
      throw e; // infrastructure failure remains fail-closed via rejection
    }
  };
}
