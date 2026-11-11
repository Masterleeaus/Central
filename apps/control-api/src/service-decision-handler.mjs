/** Opt-in Skilled service-to-service decision endpoint, no end-user login tokens accepted. */
import {authenticateSkilledService} from './service-decision-auth.mjs';
import {parseServiceDecisionRequest,readServiceDecisionBody} from './service-decision-request.mjs';
import {createSkilledDecisionAccess} from './service-decision-access.mjs';
export const SKILLED_DECISION_PATH='/v1/integrations/academy/decision';
/** Owner decision: a Skilled service decision expires 300 seconds after it is issued. */
export const SKILLED_DECISION_TTL_MS=300_000;
const respond=(res,status,body)=>{res.writeHead(status,{'cache-control':'no-store',
 'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
export function createSkilledDecisionHandler({pool,issuer,audience,token,decide,logger=()=>{},clock=()=>Date.now()}={}){
 if(typeof token!=='string'||token.length<32||typeof issuer!=='string'||!issuer.startsWith('https://')||
    typeof audience!=='string'||!audience||(!decide&&!pool))throw TypeError('Service decision configuration required');
 const current=decide??createSkilledDecisionAccess({pool,issuer,audience});
 return async(req,res)=>{
  const raw=req.url?.split('?')[0];
  if(raw!==SKILLED_DECISION_PATH)return false;
  if(req.url!==SKILLED_DECISION_PATH){respond(res,400,{error:'invalid_request'});return true;}
  if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return true;}
  if(!authenticateSkilledService(req.headers.authorization,token)){respond(res,401,{error:'unauthenticated'});return true;}
  let input;
  try{input=parseServiceDecisionRequest(await readServiceDecisionBody(req),issuer);}
  catch{respond(res,400,{error:'invalid_request'});return true;}
  if(!input){respond(res,400,{error:'invalid_request'});return true;}
  try{
   const decision=await current(input);
   if(!decision){respond(res,403,{error:'account_not_authorised'});return true;}
   // Only authenticated service credential + Central tenant-scoped RLS produces identity/revisions.
   // Issued at response time; the decision is valid until expiresAt (RFC 3339, issued-at + 300 s).
   const expiresAt=new Date(clock()+SKILLED_DECISION_TTL_MS).toISOString();
   respond(res,200,{issuer:input.issuer,subject:input.subject,requestId:input.requestId,decision:{...decision,expiresAt}});
   try{logger('skilled_decision',{application:'academy',outcome:'allow'});}catch{/* audit failure does not expose secrets */}
  }catch{
   respond(res,503,{error:'decision_unavailable'});try{logger('skilled_decision',{application:'academy',outcome:'unavailable'});}catch{}
  }
  return true;
 };
}
