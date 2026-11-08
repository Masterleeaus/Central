/** Titan Central opt-in operator API. No privileged route exists without injected live authorisation. */
import { createTitanOidcRegistrationPlans } from '../../../packages/control-plane/dist/oidc-registration.js';

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
 link:['kind','id','identityId','organisationId','applicationId','localUserId','localAccountId','verifiedAt']
};
function validCommand(command) {
 if(!isObject(command)||!Object.hasOwn(allowedCommands,command.kind)||!attrs(command,allowedCommands[command.kind])||!uuid(command.id))return false;
 const str = v => typeof v==='string'&&v.length>0&&v.length<=256;
 if(command.kind==='membership')return uuid(command.identityId)&&uuid(command.organisationId)&&['owner','admin','manager','member','learner'].includes(command.role);
 if(command.kind==='entitlement')return uuid(command.organisationId)&&['desk','field','academy'].includes(command.applicationId)&&Array.isArray(command.features)&&command.features.length<=100&&command.features.every(f=>str(f)&&f.length<=100)&&new Set(command.features).size===command.features.length&&(command.expiresAt===undefined||(str(command.expiresAt)&&Number.isFinite(Date.parse(command.expiresAt))&&new Date(command.expiresAt).toISOString()===command.expiresAt));
 if(command.kind==='link')return uuid(command.identityId)&&uuid(command.organisationId)&&['desk','field','academy'].includes(command.applicationId)&&str(command.localUserId)&&str(command.localAccountId)&&str(command.verifiedAt)&&Number.isFinite(Date.parse(command.verifiedAt));
 return false;
}
async function readJson(req, maxBytes=8192) {
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))throw new Error('unsupported_media_type');
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error('payload_too_large');chunks.push(chunk);}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('invalid_json');}
 return value;
}
/**
 * authoriseOperator must independently check current Logto authority for the verified principal.
 * Provisioning must be an already constructed TrustedProvisioningService; it repeats its own checks.
 * This handler is never installed by default in the server.
 */
export function createAdminHandler({verifyToken,authoriseOperator,provision,origins,logger=()=>{}}={}) {
 if(typeof verifyToken!=='function'||typeof authoriseOperator!=='function'||!origins)throw new Error('operator verification and fixed app origins required');
 // Eager check, not user-controlled request origins.
 const plans=createTitanOidcRegistrationPlans(origins);
 return async (req,res)=>{
  const path=new URL(req.url??'/', 'http://localhost').pathname;
  if(!['/v1/admin/oidc/plans','/v1/admin/provision'].includes(path))return false;
  const method=path.endsWith('/plans')?'GET':'POST';
  if(req.method!==method){send(res,405,{error:'method_not_allowed'});return true;}
  const token=bearer(req);
  if(!token){send(res,401,{error:'unauthenticated'});return true;}
  let principal;
  try{principal=await verifyToken(token);if(typeof principal?.logtoSubject!=='string'||!principal.logtoSubject)throw Error('bad principal');}
  catch{send(res,401,{error:'unauthenticated'});return true;}
  try{if(await authoriseOperator(principal)!==true){send(res,403,{error:'forbidden'});return true;}}
  catch{send(res,503,{error:'authority_unavailable'});return true;}
  if(req.url.includes('?')){send(res,400,{error:'unexpected_query'});return true;}
  if(path.endsWith('/plans')){send(res,200,{applications:plans,registrationStatus:'not_registered',note:'Operator-reviewed plans; no Logto registrations performed'});return true;}
  if(typeof provision!=='function'){send(res,503,{error:'provisioning_disabled'});return true;}
  // Avoid an unaudited client performing platform-level identity or organisation creation.
  let body;
  try{body=await readJson(req);}catch(e){send(res,e.message==='payload_too_large'?413:e.message==='unsupported_media_type'?415:400,{error:e.message});return true;}
  if(!attrs(body,['requestId','authorityReference','command'])||!safeRequestId(body.requestId)||typeof body.authorityReference!=='string'||!/^[a-zA-Z0-9_:.\-/]{8,256}$/.test(body.authorityReference)||!validCommand(body.command)){
    send(res,400,{error:'invalid_command'});return true;
  }
  try {
   const result=await provision({logtoSubject:principal.logtoSubject,managementCredentialVerified:true},
     {actorSubject:principal.logtoSubject,requestId:body.requestId,authorityReference:body.authorityReference},body.command);
   if(result!=='created'&&result!=='replayed')throw Error('invalid provisioning result');
   send(res,result==='created'?201:200,{status:result,requestId:body.requestId});
  }catch(e){logger('admin_provision_failed',e);send(res,503,{error:'provisioning_unavailable'});}
  return true;
 };
}
