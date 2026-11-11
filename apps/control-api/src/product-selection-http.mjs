/** One-use, browser-bound product company selection after a VERIFIED OIDC
 * callback. The selected company is never taken from the browser alone:
 * discovery is captured in durable state and the application-owned resolver
 * rechecks the current Central grant and local account immediately before
 * rotating the application's session.
 */
import {createOrganisationSelection} from './organisation-selection.mjs';
import {createConcurrencyLimiter} from './concurrency-limit.mjs';
const APPS=new Set(['field','desk','academy']);
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const BASE={'cache-control':'no-store','x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer','x-frame-options':'DENY',
 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const escape=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const respond=(res,code,body,extra={})=>{res.writeHead(code,{...BASE,'content-type':'text/plain; charset=utf-8',...extra});res.end(body)};
const cookieName=app=>'titan_'+app+'_oidc_binding';
function cookie(req,name){
 const raw=req?.headers?.cookie;
 if(typeof raw!=='string'||raw.length>8192)return null;
 let result=null;
 for(const item of raw.split(';')){
  const at=item.indexOf('=');
  if(at<1||item.slice(0,at).trim()!==name)continue;
  const value=item.slice(at+1).trim();
  if(result!==null||!TOKEN.test(value))return null;
  result=value;
 }
 return result;
}
async function form(req){
 if(!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req?.headers?.['content-type']??''))
  return null;
 let body='',bytes=0;
 try{
  for await(const chunk of req){
   bytes+=Buffer.byteLength(chunk);
   if(bytes>4096)return null;
   body+=chunk.toString('utf8');
  }
 }catch{return null}
 const fields=new URLSearchParams(body);
 if([...fields.keys()].some(key=>!['state','organisation_id'].includes(key)||fields.getAll(key).length!==1))
  return null;
 const state=fields.get('state'),organisationId=fields.get('organisation_id');
 return state&&organisationId?{state,organisationId}:null;
}
/** Required: durable one-use state, trusted server-side product company
 * names, fresh product membership+entitlement+account resolver, and atomic
 * product-owned session rotation. This does not mint Central sessions.
 */
export function createProductSelectionHttp({applicationId,origin,selectionStore,
 listOrganisations,resolveLocalIdentity,establishSession,afterLogin='/',
 concurrencyLimits={perKey:2,globalLimit:32},
 clientIp=req=>req.socket?.remoteAddress??'unknown'}={}){
 let site;
 try{site=new URL(origin)}catch{throw TypeError('secure product origin required')}
 if(!APPS.has(applicationId)||site.protocol!=='https:'||site.href!==site.origin+'/'||
   site.username||site.password||site.port||
   typeof selectionStore?.save!=='function'||typeof selectionStore?.consume!=='function'||
   typeof listOrganisations!=='function'||typeof resolveLocalIdentity!=='function'||
   typeof establishSession!=='function'||typeof afterLogin!=='string'||
   !afterLogin.startsWith('/')||afterLogin.startsWith('//')||/[\r\n]/.test(afterLogin))
  throw TypeError('trusted product selection dependencies required');
 const concurrent=createConcurrencyLimiter(concurrencyLimits);
 const clear=cookieName(applicationId)+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
 const endpoint='/auth/titan/'+applicationId+'/select';
 const coordinator=issueSession=>createOrganisationSelection({
  selectionStore,listOrganisations,
  verifySelection:async({issuer,subject,organisationId})=>{
   const local=await resolveLocalIdentity({issuer,subject,applicationId,organisationId});
   return local?.authorised===true&&local.organisationId===organisationId &&
    typeof local.localUserId==='string'&&local.localUserId.length>0&&
    typeof local.localAccountId==='string'&&local.localAccountId.length>0;
  },issueSession
 });
 return Object.freeze({
  async begin({issuer,subject,browserBinding,allowedCompanyIds}={},res){
   const result=await coordinator(async()=>false).begin({issuer,subject,browserBinding,allowedCompanyIds});
   if(result.status!=='selection_required'){
    respond(res,result.status==='denied'?403:503,'Company selection unavailable',{'set-cookie':clear});
    return;
   }
   const choices=result.organisations.map(x=>'<label><input required type="radio" name="organisation_id" value="'+escape(x.id)+'"> '+escape(x.name)+'</label>').join('');
   const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose company · Titan</title><style>body{background:#17212b;color:#f0f5f9;font:16px system-ui,sans-serif;max-width:640px;margin:6vh auto;padding:24px}label{display:block;padding:12px;background:#253849;margin:8px 0;border-radius:8px}button{padding:12px 22px;background:#245f89;color:white;border:0;border-radius:8px;cursor:pointer}</style></head><body><main><h1>Choose your company</h1><p>Select the company you want to access.</p><form method="post" action="'+endpoint+'"><input type="hidden" name="state" value="'+escape(result.state)+'"><fieldset><legend>Available companies</legend>'+choices+'</fieldset><button type="submit">Continue</button></form></main></body></html>';
   res.writeHead(200,{...BASE,'content-type':'text/html; charset=utf-8'});
   res.end(html);
  },
  async handle(req,res){
   let url;
   try{url=new URL(req.url??'/','http://localhost')}catch{return false}
   if(url.pathname!==endpoint)return false;
   const release=concurrent.acquire(clientIp(req));
   if(!release){respond(res,429,'Too many concurrent selections',{'retry-after':'1'});return true}
   try{
    if(req.method!=='POST'){respond(res,405,'Method not allowed',{'set-cookie':clear});return true}
    if(url.search||req.headers?.origin!==site.origin||
       !['same-origin','none'].includes(req.headers?.['sec-fetch-site'])){
     respond(res,403,'Selection rejected',{'set-cookie':clear});return true;
    }
    const binding=cookie(req,cookieName(applicationId)),fields=await form(req);
    if(!binding||!fields){respond(res,400,'Invalid selection',{'set-cookie':clear});return true}
    let sessionCookie=null;
    const selection=coordinator(async({issuer,subject,organisationId})=>{
     // Rechecking here prevents an access reduction between the first
     // authority read and product session rotation.
     const local=await resolveLocalIdentity({issuer,subject,applicationId,organisationId});
     if(local?.authorised!==true||local.organisationId!==organisationId||
        typeof local.localUserId!=='string'||!local.localUserId||
        typeof local.localAccountId!=='string'||!local.localAccountId)return false;
     const value=await establishSession({
      applicationId,localUserId:local.localUserId,localAccountId:local.localAccountId,
      organisationId,oidcSubject:subject,oidcIssuer:issuer
     });
     if(typeof value!=='string'||!/^([A-Za-z0-9_-]+)=[A-Za-z0-9_-]+;.*Secure;.*HttpOnly;.*SameSite=/i.test(value)||
        /[\r\n]/.test(value))return false;
     sessionCookie=value;
     return true;
    });
    const result=await selection.complete({...fields,browserBinding:binding});
    if(result.status!=='selected'||!sessionCookie){
     respond(res,result.status==='denied'?403:503,'Selection rejected',{'set-cookie':clear});return true;
    }
    res.writeHead(303,{...BASE,location:afterLogin,'set-cookie':[clear,sessionCookie]});
    res.end();return true;
   }finally{release()}
  }
 });
}
