/** Titan Central opt-in operator API. No privileged route exists without injected live authorisation. */
import { createTitanOidcRegistrationPlans } from '../../../packages/control-plane/dist/oidc-registration.js';
import { LogtoAuthorityError } from '../../../packages/control-plane/dist/logto-management.js';
import { ProvisioningForbiddenError } from '../../../packages/control-plane/dist/trusted-provisioning.js';
import { FLAG_CHANGE_PATH, flagErrorStatus, parseFlagChange } from './config-admin.mjs';
import { planLookup } from '../../../packages/control-plane/dist/product-registry.js';

const logtoId = v => typeof v==='string' && /^[A-Za-z0-9_-]{1,256}$/.test(v);
/**
 * Real operator authority: the end-user operator token must belong to a current member of the
 * configured Logto organisation AND hold one of the configured administrator role IDs, both read
 * from the Logto Management API at decision time. Email, display names and local profiles are never consulted.
 * Logto authority failures (not a member, role not held, management API rejected or unreachable) deny.
 * Other errors propagate so the caller answers 503.
 */
export function createLogtoOperatorAuthoriser({verifier,operatorOrganisationId,administrativeRoleIds}={}) {
 if(!verifier||typeof verifier.assertAnyOrganisationRole!=='function') throw new Error('Logto management verifier required');
 if(!logtoId(operatorOrganisationId)) throw new Error('operator organisation ID required');
 if(!Array.isArray(administrativeRoleIds)||administrativeRoleIds.length<1||administrativeRoleIds.length>32||!administrativeRoleIds.every(logtoId)||new Set(administrativeRoleIds).size!==administrativeRoleIds.length)
  throw new Error('explicit operator administrator role IDs required');
 const roles=Object.freeze([...administrativeRoleIds]);
 return async principal=>{
  if(!logtoId(principal?.logtoSubject)) return false;
  try{await verifier.assertAnyOrganisationRole(principal.logtoSubject,operatorOrganisationId,roles);return true;}
  catch(e){if(e instanceof LogtoAuthorityError) return false;throw e;}
 };
}

const baseHeaders = Object.freeze({'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'});
const send = (res,status,body) => {res.writeHead(status,baseHeaders);res.end(JSON.stringify(body));};
const bearer = req => {const h=req.headers.authorization;return typeof h==='string'&&/^Bearer [A-Za-z0-9_.-]+$/.test(h)?h.slice(7):undefined;};
const isObject = v => v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid = v => typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const safeRequestId = v => uuid(v);
const attrs = (value,allowed) => isObject(value)&&Object.keys(value).every(k=>allowed.includes(k));
const allowedCommands = {
 membership:['kind','id','identityId','organisationId','role'],
 entitlement:['kind','id','organisationId','applicationId','features','expiresAt'],
 link:['kind','id','identityId','organisationId','applicationId','localUserId','localAccountId','assertion'],
 link_relink:['kind','id','identityId','organisationId','applicationId','expectedRevision','localUserId','localAccountId','assertion'],
 link_revoke:['kind','id','organisationId','expectedRevision'],
 membership_update:['kind','id','organisationId','expectedRevision','role','state']
};
/** Tenant administrators may use only these commands, and only through the tenant route (see createAdminHandler). */
const TENANT_COMMANDS = Object.freeze(['membership','membership_update']);
const MEMBER_STATES = Object.freeze(['active','invited','suspended','revoked']);
/** Compact JWS shape. The signature is verified by TrustedProvisioningService, never here. */
const ASSERTION = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
function validCommand(command) {
 if(!isObject(command)||!Object.hasOwn(allowedCommands,command.kind)||!attrs(command,allowedCommands[command.kind])||!uuid(command.id))return false;
 const str = v => typeof v==='string'&&v.length>0&&v.length<=256;
 if(command.kind==='membership')return uuid(command.identityId)&&uuid(command.organisationId)&&['owner','admin','manager','member','learner'].includes(command.role);
 if(command.kind==='entitlement')return uuid(command.organisationId)&&['desk','field','academy'].includes(command.applicationId)&&Array.isArray(command.features)&&command.features.length<=100&&command.features.every(f=>str(f)&&f.length<=100)&&new Set(command.features).size===command.features.length&&(command.expiresAt===undefined||(str(command.expiresAt)&&Number.isFinite(Date.parse(command.expiresAt))&&new Date(command.expiresAt).toISOString()===command.expiresAt));
 const revision = v => Number.isSafeInteger(v)&&v>=1;
 if(command.kind==='membership_update')return uuid(command.organisationId)&&revision(command.expectedRevision)&&(command.role!==undefined||command.state!==undefined)
   &&(command.role===undefined||['owner','admin','manager','member','learner'].includes(command.role))&&(command.state===undefined||MEMBER_STATES.includes(command.state));
 if(command.kind==='link')return uuid(command.identityId)&&uuid(command.organisationId)&&['desk','field','academy'].includes(command.applicationId)&&str(command.localUserId)&&str(command.localAccountId)&&typeof command.assertion==='string'&&command.assertion.length<=4096&&ASSERTION.test(command.assertion);
 if(command.kind==='link_relink')return uuid(command.identityId)&&uuid(command.organisationId)&&['desk','field','academy'].includes(command.applicationId)&&revision(command.expectedRevision)&&str(command.localUserId)&&str(command.localAccountId)&&typeof command.assertion==='string'&&command.assertion.length<=4096&&ASSERTION.test(command.assertion);
 if(command.kind==='link_revoke')return uuid(command.organisationId)&&revision(command.expectedRevision);
 return false;
}
async function readJson(req, maxBytes=8192) {
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))throw new Error('unsupported_media_type');
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error('payload_too_large');chunks.push(chunk);}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('invalid_json');}
 return value;
}
const ORGANISATION_ACCESS = /^\/v1\/admin\/organisations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/access$/i;
const TENANT_PROVISION_PATH = '/v1/admin/tenant/provision';
const METHODS = Object.freeze({'/v1/admin/oidc/plans':'GET','/v1/admin/provision':'POST',[TENANT_PROVISION_PATH]:'POST'});
/** Maps a provisioning failure to a response. Refusals and revision conflicts are distinguishable; details never leak. */
function provisioningFailure(e){
 if(e instanceof ProvisioningForbiddenError) return [403,{error:'forbidden'}];
 if(typeof e?.message==='string'&&e.message.startsWith('revision conflict')) return [409,{error:'revision_conflict'}];
 return [503,{error:'provisioning_unavailable'}];
}

/**
 * authoriseOperator must independently check current Logto authority for the verified principal.
 * Routes:
 *  GET  /v1/admin/oidc/plans                      operator; read-only plans.
 *  POST /v1/admin/provision                       operator; trusted provisioning (disabled unless provision is injected).
 *  GET  /v1/admin/organisations/{id}/access       operator; one organisation's users, memberships, entitlements and links.
 *  POST /v1/admin/tenant/provision                tenant administrator; membership and membership_update only.
 *    The tenant route has NO operator check. Its authority is decided inside provisionTenant, which must be a
 *    TrustedProvisioningService built with createTenantAdministrationAuthorizer (org admin role plus Titan delegation).
 *  POST /v1/admin/flags/change                    operator; feature-flag change (served only when flagChange is injected).
 * Provision functions repeat their own checks. This handler is never installed by default in the server.
 */
/** flagChange, when given, enables POST /v1/admin/flags/change: async (command, operatorSubject) => revision. Omitted means the route is not served. */
export function createAdminHandler({verifyToken,authoriseOperator,provision,provisionTenant,readOrganisation,origins,productRegistry,logger=()=>{},flagChange}={}) {
 if(typeof verifyToken!=='function'||typeof authoriseOperator!=='function'||!origins)throw new Error('operator verification and fixed app origins required');
 if(flagChange!==undefined&&typeof flagChange!=='function')throw new Error('flagChange must be a function');
 // Eager check, not user-controlled request origins.
 const plans=createTitanOidcRegistrationPlans(origins);
 // Canonical product id shown beside the legacy id. Origins still come from the validated plans, which the
 // operator builds from the registry. The product lookup adds labels only.
 const lookup=productRegistry?planLookup(productRegistry):undefined;
 const planWithProduct=plan=>{
  if(!lookup) return plan;
  const entry=lookup[plan.app];
  if(!entry||entry.serviceOrigin!==plan.origin) throw Error('plan origin differs from validated registry');
  return {...plan,productId:entry.productId,legacyId:entry.legacyId,displayName:entry.displayName};
 };
 return async (req,res)=>{
  let path;
  try{path=new URL(req.url??'/', 'http://localhost').pathname;}catch{send(res,400,{error:'invalid_url'});return true;}
  const access=path.match(ORGANISATION_ACCESS);
  const flagPath=Boolean(flagChange)&&path===FLAG_CHANGE_PATH;
  if(!access&&!flagPath&&!Object.hasOwn(METHODS,path))return false;
  const method=access?'GET':flagPath?'POST':METHODS[path];
  if(req.method!==method){send(res,405,{error:'method_not_allowed'});return true;}
  const token=bearer(req);
  if(!token){send(res,401,{error:'unauthenticated'});return true;}
  let principal;
  try{principal=await verifyToken(token);if(typeof principal?.logtoSubject!=='string'||!principal.logtoSubject)throw Error('bad principal');}
  catch{send(res,401,{error:'unauthenticated'});return true;}
  if(path===TENANT_PROVISION_PATH){
   if(req.url.includes('?')){send(res,400,{error:'unexpected_query'});return true;}
   if(typeof provisionTenant!=='function'){send(res,503,{error:'provisioning_disabled'});return true;}
   const body=await readEnvelope(req,res);
   if(!body)return true;
   // Refused by kind before the command's own schema is checked, so no unpermitted command is ever parsed further.
   if(!TENANT_COMMANDS.includes(body.command.kind)){send(res,403,{error:'command_not_permitted'});return true;}
   if(!validCommand(body.command)){send(res,400,{error:'invalid_command'});return true;}
   try{
    // Authority for a tenant administrator is decided by provisionTenant (organisation-scoped policy, re-checked there).
    const result=await provisionTenant({logtoSubject:principal.logtoSubject,operatorAuthorityVerified:true},
      {actorSubject:principal.logtoSubject,requestId:body.requestId,authorityReference:body.authorityReference},body.command);
    if(result!=='created'&&result!=='updated'&&result!=='replayed')throw Error('invalid provisioning result');
    send(res,result==='created'?201:200,{status:result,requestId:body.requestId});
   }catch(e){logger('admin_tenant_provision_failed',e);const [status,payload]=provisioningFailure(e);send(res,status,payload);}
   return true;
  }
  let operatorAuthorised;
  try{operatorAuthorised=await authoriseOperator(principal)===true;}
  catch{send(res,503,{error:'authority_unavailable'});return true;}
  if(!operatorAuthorised){send(res,403,{error:'forbidden'});return true;}
  if(req.url.includes('?')){send(res,400,{error:'unexpected_query'});return true;}
  if(flagPath){
   let body;
   try{body=await readJson(req);}catch(e){send(res,e.message==='payload_too_large'?413:e.message==='unsupported_media_type'?415:400,{error:e.message});return true;}
   const command=parseFlagChange(body);
   if(!command){send(res,400,{error:'invalid_command'});return true;}
   try{
    const revision=await flagChange(command,principal.logtoSubject);
    logger('admin_flag_changed',{op:command.op,product:command.product,environment:command.environment,key:command.key,revision});
    send(res,200,{status:'changed',revision});
   }catch(e){
    const status=flagErrorStatus(e);
    if(status){send(res,status,{error:e.code.toLowerCase()});return true;}
    logger('admin_flag_change_failed',{error_class:e?.name});
    send(res,503,{error:'flag_store_unavailable'});
   }
   return true;
  }
  if(access){
   if(typeof readOrganisation!=='function'){send(res,503,{error:'read_disabled'});return true;}
   try{
    const found=await readOrganisation(access[1]);
    if(found===undefined){send(res,404,{error:'not_found'});return true;}
    send(res,200,found);
   }catch(e){logger('admin_read_failed',e);send(res,503,{error:'read_unavailable'});}
   return true;
  }
  if(path.endsWith('/plans')){send(res,200,{applications:plans.map(planWithProduct),registrationStatus:'not_registered',note:'Operator-reviewed plans; no Logto registrations performed'});return true;}
  if(typeof provision!=='function'){send(res,503,{error:'provisioning_disabled'});return true;}
  // Avoid an unaudited client performing platform-level identity or organisation creation.
  const body=await readEnvelope(req,res);
  if(!body)return true;
  if(!validCommand(body.command)){send(res,400,{error:'invalid_command'});return true;}
  try {
   // operatorAuthorityVerified does NOT mean the bearer token is a machine credential: an end-user
   // operator token is never trusted as one. It is set only here, from authoriseOperator returning true
   // (Logto organisation membership plus an administrator role, checked on this request via the
   // Management API). TrustedProvisioningService and the organisation authoriser re-check authority.
   const result=await provision({logtoSubject:principal.logtoSubject,operatorAuthorityVerified:operatorAuthorised},
     {actorSubject:principal.logtoSubject,requestId:body.requestId,authorityReference:body.authorityReference},body.command);
   if(result!=='created'&&result!=='updated'&&result!=='replayed')throw Error('invalid provisioning result');
   send(res,result==='created'?201:200,{status:result,requestId:body.requestId});
  }catch(e){logger('admin_provision_failed',e);const [status,payload]=provisioningFailure(e);send(res,status,payload);}
  return true;
 };
}
/** Parses the provisioning envelope (JSON, media type, size, exact keys, request ID and authority reference).
 * The command is checked separately by the caller. Sends the error response itself and returns undefined on failure. */
async function readEnvelope(req,res){
  let body;
  try{body=await readJson(req);}catch(e){send(res,e.message==='payload_too_large'?413:e.message==='unsupported_media_type'?415:400,{error:e.message});return undefined;}
  if(!attrs(body,['requestId','authorityReference','command'])||!safeRequestId(body.requestId)||typeof body.authorityReference!=='string'||!/^[a-zA-Z0-9_:.\-/]{8,256}$/.test(body.authorityReference)){
    send(res,400,{error:'invalid_command'});return undefined;
  }
  return body;
}
