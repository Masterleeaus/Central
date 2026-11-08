/** Explicit authority gate for Titan Central provisioning.
 * This service is only for an authenticated backend. Caller MUST pass a trusted actor
 * (verified server-side, never from JSON body), and an independently implemented policy.
 */
import type { ProvisioningCommand, ProvisioningContext } from './provisioning.js';
import { CentralProvisioner } from './provisioning.js';
import { LogtoManagementVerifier } from './logto-management.js';
export type TrustedActor={logtoSubject:string; managementCredentialVerified:true};
export type AuthorizeProvisioning=(actor:TrustedActor,command:ProvisioningCommand)=>Promise<boolean>;
export type VerifyLocalLink=(command:Extract<ProvisioningCommand,{kind:'link'}>)=>Promise<boolean>;
export type GetCanonicalLogtoId=(type:'identity'|'organisation',uuid:string)=>Promise<string|undefined>;
export class TrustedProvisioningService {
 constructor(private readonly provisioner:CentralProvisioner,private readonly logto:LogtoManagementVerifier,
  private readonly authorize:AuthorizeProvisioning,private readonly resolve:GetCanonicalLogtoId,
  private readonly verifyLocalLink:VerifyLocalLink){}
 async apply(actor:TrustedActor,context:ProvisioningContext,command:ProvisioningCommand):Promise<'created'|'replayed'> {
  if(!actor||actor.managementCredentialVerified!==true||!actor.logtoSubject||actor.logtoSubject!==context.actorSubject) throw Error('unverified provisioning actor');
  // Authorize before querying management services or writing SQL. Fail closed by default.
  if(await this.authorize(actor,command)!==true) throw Error('provisioning forbidden');
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
   case 'link':{
    const user=await this.resolve('identity',command.identityId);
    const org=await this.resolve('organisation',command.organisationId);
    if(!user||!org) throw Error('unverified canonical identity or organisation');
    await this.logto.assertMembership(user,org);
    if(await this.verifyLocalLink(command)!==true)throw Error('unverified application account control');
    break;
   }
   default:throw Error('unsupported provisioning');
  }
  return this.provisioner.apply(context,command);
 }
}
