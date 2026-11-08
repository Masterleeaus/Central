/** Central OIDC browser callback. The injected OIDC login is responsible for
 * durable one-use PKCE state, signed ID-token verification and nonce checking.
 * No public route is mounted until the host integrates this handler explicitly.
 */
import {randomBytes} from 'node:crypto';
import {isSecureEndpoint,insecureLocalhostAllowed} from './endpoint-policy.mjs';
import {createRateLimiter} from './rate-limit.mjs';
import {clearSessionCookie} from './central-session.mjs';
const BINDING='__Host-titan-central-oidc';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
const cookie=(value,age)=>BINDING+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+age;
const clearBinding=()=>cookie('',0);
const respond=(res,status,error,cookies)=>{
  res.writeHead(status,{...headers,'content-type':'application/json; charset=utf-8',...(cookies?{'set-cookie':cookies}:{})});
  res.end(JSON.stringify({error}));
};
function readBinding(req){
  const raw=req?.headers?.cookie;
  if(typeof raw!=='string'||raw.length>8192)return null;
  let found=null;
  for(const item of raw.split(';')){
    const part=item.trim(),i=part.indexOf('=');
    if(i<1||part.slice(0,i)!==BINDING)continue;
    const value=part.slice(i+1);
    if(found!==null||!TOKEN.test(value))return null;
    found=value;
  }
  return found;
}
function uniqueEligible(entries){
  if(!Array.isArray(entries)||entries.length!==1)return null;
  const candidate=entries[0];
  return candidate?.authorised===true && typeof candidate.companyId==='string' && UUID.test(candidate.companyId)?candidate.companyId:null;
}
/** listEligibleCompanies and recheckCompany MUST query authoritative membership
 * records, not browser claims or cached profile metadata. Multi-company users
 * fail closed until issue #32's explicit selection handshake is implemented.
 */
export function createCentralOidcBrowserHandler({oidcLogin,sessions,listEligibleCompanies,recheckCompany,
  allowInsecureLocalhost=insecureLocalhostAllowed(),clientIp=req=>req.socket?.remoteAddress??'unknown',
  logger=()=>{},rateLimits={ip:{limit:30,windowMs:60000},subject:{limit:10,windowMs:60000}}}={}){
  if(typeof oidcLogin?.begin!=='function'||typeof oidcLogin?.complete!=='function'||
    typeof sessions?.issue!=='function'||typeof listEligibleCompanies!=='function'||typeof recheckCompany!=='function')
    throw new TypeError('trusted central OIDC dependencies required');
  const ipLimiter=createRateLimiter(rateLimits.ip);
  const subjectLimiter=createRateLimiter(rateLimits.subject);
  const audit=(event,fields={})=>{try{logger(event,fields);}catch{/* never log sensitive tokens */}};
  return async function handleCentralOidc(req,res){
    let url;
    try{url=new URL(req.url??'/','http://localhost');}catch{respond(res,400,'invalid_url');return true;}
    const start=url.pathname==='/auth/central/start';
    const callback=url.pathname==='/auth/central/callback';
    if(!start&&!callback)return false;
    if(req.method!=='GET'){respond(res,405,'method_not_allowed');return true;}
    if(!ipLimiter.take(clientIp(req)).allowed){respond(res,429,'rate_limited');return true;}
    if(start){
      if(url.search){respond(res,400,'unexpected_login_parameters');return true;}
      try{
        const binding=randomBytes(32).toString('base64url');
        const result=await oidcLogin.begin({browserBinding:binding});
        const auth=new URL(result.authorizationUrl);
        if(!isSecureEndpoint(auth.href,allowInsecureLocalhost))throw Error('invalid_authorization_url');
        res.writeHead(303,{...headers,location:auth.href,'set-cookie':cookie(binding,600)});
        res.end();
      }catch{audit('central_login_start_failed');respond(res,503,'login_unavailable');}
      return true;
    }
    const cleared=[clearBinding(),clearSessionCookie()];
    const fail=(status,reason)=>{audit('central_login_denied',{reason});respond(res,status,reason,cleared);};
    const params=url.searchParams;
    if([...params.keys()].some(k=>!['state','code','error','error_description'].includes(k)||params.getAll(k).length!==1)){
      fail(400,'invalid_callback');return true;
    }
    if(params.has('error')){fail(401,'identity_provider_rejected');return true;}
    const browserBinding=readBinding(req),state=params.get('state'),code=params.get('code');
    if(!browserBinding||!state||!code||state.length>256||code.length>4096){
      fail(400,'invalid_callback');return true;
    }
    try{
      const verified=await oidcLogin.complete({state,code,browserBinding});
      if(typeof verified?.subject!=='string'||!verified.subject||typeof verified.issuer!=='string'||!verified.issuer)
        throw Error('invalid_identity');
      if(!subjectLimiter.take(verified.subject).allowed){fail(429,'rate_limited');return true;}
      const identity={issuer:verified.issuer,subject:verified.subject};
      const companyId=uniqueEligible(await listEligibleCompanies(identity));
      if(!companyId){fail(403,'company_selection_required');return true;}
      if(await recheckCompany({...identity,companyId})!==true){fail(403,'company_access_denied');return true;}
      const issued=await sessions.issue({identityId:verified.subject,companyId});
      if(typeof issued?.cookie!=='string'||!issued.cookie.startsWith('__Host-titan-central='))throw Error('invalid_session');
      res.writeHead(303,{...headers,location:'/central','set-cookie':[clearBinding(),issued.cookie]});
      res.end();
      audit('central_login_succeeded',{outcome:'allow'});
    }catch{fail(401,'login_failed');}
    return true;
  };
}
