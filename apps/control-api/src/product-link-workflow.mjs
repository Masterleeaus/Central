/** Link/unlink orchestration requiring a product-owned proof and trusted actor.
 *
 * Not an HTTP route. Caller authenticates the operator on the server and
 * supplies authorisation callbacks and a TrustedProvisioningService. The
 * product proof is checked independently of Logto membership and must be
 * consumed once before any write. Both command and linked record are
 * checked for expected company, identity and revision. All durable account
 * changes and revocation generations remain owned by CentralProvisioner.
 */
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const APPS=new Set(['field','desk','academy']);
const SAFE=/^[A-Za-z0-9:_-]{1,200}$/;
const actorValid=(actor,context)=>actor&&actor.operatorAuthorityVerified===true&&
 typeof actor.logtoSubject==='string'&&SAFE.test(actor.logtoSubject)&&
 actor.logtoSubject===context?.actorSubject;
export function createProductAccountLinkWorkflow({
 trustedProvisioning,proofVerifier,authoriseLink,authoriseUnlink,resolveLink
}={}){
 if(typeof trustedProvisioning?.apply!=='function'||typeof proofVerifier?.verify!=='function'||
  typeof authoriseLink!=='function'||typeof authoriseUnlink!=='function'||
  typeof resolveLink!=='function')throw TypeError('trusted account link workflow dependencies required');
 return Object.freeze({
  async link(actor,context,command,proof){
   if(!actorValid(actor,context)||command?.kind!=='link'||!UUID.test(command.id??'')||
    !UUID.test(command.identityId??'')||!UUID.test(command.organisationId??'')||
    !APPS.has(command.applicationId)||!SAFE.test(command.localUserId??'')||
    !SAFE.test(command.localAccountId??'')||
    typeof command.verifiedAt!=='string'||!Number.isFinite(Date.parse(command.verifiedAt)))
    throw Error('invalid authorised account link');
   if(await authoriseLink(actor,context,command)!==true)throw Error('account link not authorised');
   // A collision in the canonical link mapping needs an operator-reviewed
   // resolution; never silently overwrite a different product account.
   const current=await resolveLink({id:command.id,organisationId:command.organisationId});
   if(current!==null&&current!==undefined)throw Error('existing account link requires review');
   if(await proofVerifier.verify({proof,command})!==true)
    throw Error('product account control not proven');
   return trustedProvisioning.apply(actor,context,command);
  },
  async unlink(actor,context,command){
   if(!actorValid(actor,context)||command?.kind!=='link_revoke'||
    !UUID.test(command.id??'')||!UUID.test(command.organisationId??'')||
    !Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<1)
    throw Error('invalid authorised unlink');
   const current=await resolveLink({id:command.id,organisationId:command.organisationId});
   if(!current||current.id!==command.id||current.organisationId!==command.organisationId||
    !APPS.has(current.applicationId)||!SAFE.test(current.localUserId??'')||
    !Number.isSafeInteger(current.revision)||
    current.revision!==command.expectedRevision||current.status!=='verified')
    throw Error('account unlink revision or scope conflict');
   if(await authoriseUnlink(actor,context,command,current)!==true)
    throw Error('account unlink not authorised');
   // The existing provisioner atomically writes a link_revoke audit event,
   // increments revision and revokes affected application sessions.
   return trustedProvisioning.apply(actor,context,command);
  }
 });
}
