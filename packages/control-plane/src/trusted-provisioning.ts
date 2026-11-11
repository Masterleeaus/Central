/** Explicit authority gate for Titan Central provisioning.
 * This service is only for an authenticated backend. Caller MUST pass a trusted actor
 * (verified server-side, never from JSON body), and an independently implemented policy.
 */
import type { LinkAssertionCommand, ProvisioningCommand, ProvisioningContext } from './provisioning.js';
import { CentralProvisioner } from './provisioning.js';
import { LogtoManagementVerifier } from './logto-management.js';
/** `operatorAuthorityVerified` records that the caller's Logto organisation authority was checked against the
 * Management API for this request. It is NOT evidence that an end-user bearer token is a machine credential. */
export type TrustedActor={logtoSubject:string; operatorAuthorityVerified:true};
export type AuthorizeProvisioning=(actor:TrustedActor,command:ProvisioningCommand)=>Promise<boolean>;
/** Verifies the product-signed assertion carried by a link command against the Central identity and organisation.
 * `logtoSubject` and `logtoOrganisationId` are resolved by Central, never taken from the command. */
export interface LinkCheckInput { command:LinkAssertionCommand; logtoSubject:string; logtoOrganisationId:string; }
export type VerifyLocalLink=(input:LinkCheckInput)=>Promise<boolean>;
export type GetCanonicalLogtoId=(type:'identity'|'organisation',uuid:string)=>Promise<string|undefined>;
/** Thrown when the authorisation policy refuses a command. Carries no detail beyond the refusal. */
export class ProvisioningForbiddenError extends Error {
 constructor(){ super('provisioning forbidden'); this.name='ProvisioningForbiddenError'; }
}
export class TrustedProvisioningService {
 constructor(private readonly provisioner:CentralProvisioner,private readonly logto:LogtoManagementVerifier,
  private readonly authorize:AuthorizeProvisioning,private readonly resolve:GetCanonicalLogtoId,
  private readonly verifyLocalLink:VerifyLocalLink){}
 async apply(actor:TrustedActor,context:ProvisioningContext,command:ProvisioningCommand):Promise<'created'|'updated'|'replayed'> {
  if(!actor||actor.operatorAuthorityVerified!==true||!actor.logtoSubject||actor.logtoSubject!==context.actorSubject) throw Error('unverified provisioning actor');
  // Authorize before querying management services or writing SQL. Fail closed by default.
  if(await this.authorize(actor,command)!==true) throw new ProvisioningForbiddenError();
  // An identical retry of an applied resolution is answered without verifying its assertion again: the nonce was spent.
  if(command.kind==='link_review_resolve'&&typeof this.provisioner.wasApplied==='function'&&await this.provisioner.wasApplied(context,command)) return 'replayed';
  switch(command.kind){
   case 'identity': await this.logto.assertIdentity(command.logtoSubject);break;
   case 'organisation':await this.logto.assertOrganisation(command.logtoOrganisationId);break;
   case 'membership':{
    const user=await this.resolve('identity',command.identityId);
    const org=await this.resolve('organisation',command.organisationId);
    if(!user||!org) throw Error('unverified canonical identity or organisation');
    await this.logto.assertMembership(user,org);break;
   }
   case 'entitlement':{
    const org=await this.resolve('organisation',command.organisationId);
    if(!org)throw Error('unverified organisation');
    await this.logto.assertOrganisation(org);break;
   }
   case 'link':
   case 'link_relink':{
    const user=await this.resolve('identity',command.identityId);
    const org=await this.resolve('organisation',command.organisationId);
    if(!user||!org) throw Error('unverified canonical identity or organisation');
    await this.logto.assertMembership(user,org);
    if(await this.verifyLocalLink({command,logtoSubject:user,logtoOrganisationId:org})!==true)throw Error('unverified application account control');
    break;
   }
   // Reductions (suspend, demote, revoke) must still succeed after Logto has removed the
   // membership, so no live Logto membership check applies. The organisation must still
   // resolve canonically; the authorize policy above is the control for the row itself.
   case 'link_review_resolve':{
    // Rejection creates nothing, so it needs only the canonical organisation (as for reductions).
    // Approval creates or relinks an account, so it needs what a link needs: live membership and a verified assertion.
    const org=await this.resolve('organisation',command.organisationId);
    if(!org) throw Error('unverified organisation');
    if(command.decision==='rejected') break;
    const user=await this.resolve('identity',command.identityId);
    if(!user) throw Error('unverified canonical identity');
    await this.logto.assertMembership(user,org);
    if(await this.verifyLocalLink({command,logtoSubject:user,logtoOrganisationId:org})!==true)throw Error('unverified application account control');
    break;
   }
   case 'membership_update':
   case 'entitlement_update':
   case 'link_revoke':{
    const org=await this.resolve('organisation',command.organisationId);
    if(!org) throw Error('unverified organisation');
    break;
   }
   default:throw Error('unsupported provisioning');
  }
  return this.provisioner.apply(context,command);
 }
}
