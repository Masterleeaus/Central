/** Browser company choice after a verified OIDC callback.
 * The existing organisation-selection coordinator owns one-use, browser-bound
 * state and the current membership check. This layer owns only the HTML form
 * and a strict same-origin POST. It never trusts a subject supplied in HTTP.
 */
import {createOrganisationSelection} from './organisation-selection.mjs';
import {createConcurrencyLimiter} from './concurrency-limit.mjs';
const BINDING='__Host-titan-central-oidc';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const HEADERS={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const clearBinding=BINDING+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function binding(req){
  const header=req?.headers?.cookie;
  if(typeof header!=='string'||header.length>8192)return null;
  let found=null;
  for(const raw of header.split(';')){
    const item=raw.trim(),at=item.indexOf('=');
    if(at<1||item.slice(0,at)!==BINDING)continue;
    const value=item.slice(at+1);
    if(found!==null||!TOKEN.test(value))return null;
    found=value;
  }
  return found;
}
async function readForm(req){
  if(!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers?.['content-type']??''))return null;
  let raw='',size=0;
  try{
    for await(const chunk of req){
      size+=Buffer.byteLength(chunk);
      if(size>4096)return null;
      raw+=chunk.toString();
    }
  }catch{return null;}
  const params=new URLSearchParams(raw);
  if([...params.keys()].some(k=>!['state','organisation_id'].includes(k)||params.getAll(k).length!==1))return null;
  const state=params.get('state'),organisationId=params.get('organisation_id');
  return state&&organisationId?{state,organisationId}:null;
}
const error=(res,status,message)=>{res.writeHead(status,{...HEADERS,'content-type':'text/plain; charset=utf-8','set-cookie':clearBinding});res.end(message);};
export function createCentralSelectionHttp({selectionStore,listOrganisations,recheckCompany,sessions,origin,concurrencyLimits={perKey:2,globalLimit:32},clientIp=req=>req.socket?.remoteAddress??'unknown'}={}){
  let site;
  try{site=new URL(origin);}catch{throw new TypeError('trusted selection origin required');}
  if(site.protocol!=='https:'||site.href!==site.origin+'/'||site.username||site.password||
    !selectionStore?.save||!selectionStore?.consume||typeof listOrganisations!=='function'||
    typeof recheckCompany!=='function'||typeof sessions?.issue!=='function')
    throw new TypeError('trusted company selection dependencies required');
  const concurrent=createConcurrencyLimiter(concurrencyLimits);
  const coordinator=issueSession=>createOrganisationSelection({
    selectionStore,listOrganisations,
    verifySelection:({issuer,subject,organisationId})=>recheckCompany({issuer,subject,companyId:organisationId}),
    issueSession
  });
  return Object.freeze({
    async begin({issuer,subject,browserBinding,allowedCompanyIds},res){
      const result=await coordinator(async()=>false).begin({issuer,subject,browserBinding,allowedCompanyIds});
      if(result.status!=='selection_required'){error(res,result.status==='denied'?403:503,'Company selection unavailable');return;}
      const choices=result.organisations.map(x=>'<label><input required type="radio" name="organisation_id" value="'+escape(x.id)+'"> '+escape(x.name)+'</label>').join('');
      const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Choose company · Titan Central</title><style>body{font:16px system-ui,sans-serif;background:#17212b;color:#f0f5f9;max-width:640px;margin:6vh auto;padding:24px}fieldset{border:1px solid #607283;border-radius:12px;padding:20px}label{display:block;padding:12px;background:#253849;margin:8px 0;border-radius:8px}button{padding:12px 22px;background:#245f89;color:#fff;border:0;border-radius:8px;cursor:pointer}</style></head><body><main><h1>Choose your company</h1><p>Select the company you want to access.</p><form method="post" action="/auth/central/select"><input type="hidden" name="state" value="'+escape(result.state)+'"><fieldset><legend>Available companies</legend>'+choices+'</fieldset><p><button type="submit">Continue</button></p></form></main></body></html>';
      res.writeHead(200,{...HEADERS,'content-type':'text/html; charset=utf-8'});
      res.end(html);
    },
    async handle(req,res){
      let url;
      try{url=new URL(req.url??'/','http://localhost');}catch{return false;}
      if(url.pathname!=='/auth/central/select')return false;
      const release=concurrent.acquire(clientIp(req));
      if(!release){res.writeHead(429,{...HEADERS,'retry-after':'1','content-type':'text/plain; charset=utf-8'});res.end('Too many concurrent selections');return true;}
      try{
      if(req.method!=='POST'){error(res,405,'Method not allowed');return true;}
      if(url.search||req.headers?.origin!==site.origin){error(res,403,'Selection rejected');return true;}
      const browserBinding=binding(req),fields=await readForm(req);
      if(!browserBinding||!fields){error(res,400,'Invalid selection');return true;}
      let sessionCookie=null;
      const selection=coordinator(async({subject,organisationId})=>{
        const issued=await sessions.issue({identityId:subject,companyId:organisationId});
        if(typeof issued?.cookie!=='string'||!issued.cookie.startsWith('__Host-titan-central='))return false;
        sessionCookie=issued.cookie;return true;
      });
      const result=await selection.complete({...fields,browserBinding});
      if(result.status!=='selected'||!sessionCookie){
        error(res,result.status==='denied'?403:503,'Selection rejected');return true;
      }
      res.writeHead(303,{...HEADERS,location:'/central','set-cookie':[clearBinding,sessionCookie]});
      res.end();
      return true;
      } finally {release();}
    }
  });
}
