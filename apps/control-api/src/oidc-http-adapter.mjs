/** Framework-neutral OIDC browser route adapter. App-owned sessions stay app-owned.
 * Mount only on exact GET paths and supply trusted local session and account binding.
 * Callback requests are rate-limited per client IP before the token exchange, and per
 * verified subject afterwards. Production limits must also be set at the reverse proxy.
 */
import { randomBytes } from 'node:crypto';
import { insecureLocalhostAllowed, isSecureEndpoint } from './endpoint-policy.mjs';
import { createRateLimiter } from './rate-limit.mjs';

const allowedApps = new Set(['desk', 'field', 'academy']);
const token = () => randomBytes(32).toString('base64url');
const DEFAULT_RATE_LIMITS = Object.freeze({ ip: { limit: 30, windowMs: 60_000 }, subject: { limit: 10, windowMs: 60_000 } });
const reply = (res, status, body, extra = {}) => {
  res.writeHead(status, {'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff',...extra});
  res.end(JSON.stringify(body));
};
const redirect = (res, destination, cookie) => {
  res.writeHead(303, {location:destination,'cache-control':'no-store', ...(cookie?{'set-cookie':cookie}:{})});
  res.end();
};
const parseCookies = (req) => {
  const header=req.headers.cookie;
  if (typeof header!=='string'||header.length>8192) return {};
  const cookies=Object.create(null);
  for (const item of header.split(';')) {
    const separator=item.indexOf('='); if(separator<1)continue;
    const key=item.slice(0,separator).trim(); const value=item.slice(separator+1).trim();
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(key)||Object.hasOwn(cookies,key))continue;
    cookies[key]=value;
  }
  return cookies;
};
const validBinding = value => typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const cookieValue = (name,value,ttl) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${ttl}`;
const clearCookie = name => cookieValue(name,'',0);
const errorClass = error => (typeof error?.name==='string' ? error.name : 'unknown');

/**
 * oidcLogin: Pass 10 flow with Pass 11 state store and ID-token verifier.
 * resolveLocalIdentity: app-owned lookup of issuer + subject, never by email alone.
 * establishSession: app-owned session rotation/creation; returns opaque session cookie.
 * On absent identity, fail closed rather than implicitly creating a privileged account.
 * logger(event, fields) receives structured outcome fields only: never tokens, subjects or codes.
 */
export function createOidcHttpAdapter({applicationId,oidcLogin,resolveLocalIdentity,establishSession,afterLogin='/',logger=()=>{},
  allowInsecureLocalhost=insecureLocalhostAllowed(),rateLimits=DEFAULT_RATE_LIMITS,clientIp=(req)=>req.socket?.remoteAddress??'unknown'}={}) {
  if(!allowedApps.has(applicationId)||!oidcLogin?.begin||!oidcLogin?.complete||typeof resolveLocalIdentity!=='function'||typeof establishSession!=='function'||typeof afterLogin!=='string'||!afterLogin.startsWith('/')||afterLogin.startsWith('//')||/[\r\n]/.test(afterLogin))throw new TypeError('invalid OIDC route adapter configuration');
  const ipLimiter=createRateLimiter(rateLimits.ip);
  const subjectLimiter=createRateLimiter(rateLimits.subject);
  const audit=(event,fields={})=>{try{logger(event,{application:applicationId,...fields});}catch{/* logging never alters the outcome */}};
  const bindingCookie=`titan_${applicationId}_oidc_binding`;

  async function handle(req,res) {
    let url;
    try {url=new URL(req.url??'/', 'http://localhost');}catch{reply(res,400,{error:'invalid_url'});return true;}
    const expectedStart=`/auth/titan/${applicationId}/start`;
    const expectedCallback=`/auth/titan/${applicationId}/callback`;
    if(url.pathname!==expectedStart&&url.pathname!==expectedCallback)return false;
    if(req.method!=='GET'){reply(res,405,{error:'method_not_allowed'});return true;}
    if(url.pathname===expectedStart){
      if(url.search){reply(res,400,{error:'unexpected_login_parameters'});return true;}
      try {
        const binding=token();
        const {authorizationUrl}=await oidcLogin.begin({browserBinding:binding});
        const authUrl=new URL(authorizationUrl);
        if(!isSecureEndpoint(authUrl.href,allowInsecureLocalhost))throw Error('invalid_authorization_url');
        redirect(res,authUrl.href,cookieValue(bindingCookie,binding,600));
      }catch(error){audit('login_begin_failed',{error_class:errorClass(error)});reply(res,503,{error:'login_unavailable'});}
      return true;
    }
    const clear=clearCookie(bindingCookie);
    const fail=(status,reason,extra={})=>{res.writeHead(status,{'cache-control':'no-store','content-type':'application/json','set-cookie':clear,...extra});res.end(JSON.stringify({error:reason}));};
    // Per-IP limit before any state consumption or token exchange.
    const ipDecision=ipLimiter.take(clientIp(req));
    if(!ipDecision.allowed){audit('login_rate_limited',{scope:'ip'});reply(res,429,{error:'rate_limited'},{'retry-after':String(ipDecision.retryAfterSeconds)});return true;}
    if(Array.from(url.searchParams.keys()).some(k=>!['state','code','error','error_description'].includes(k)||url.searchParams.getAll(k).length!==1)) {audit('login_rejected',{reason:'invalid_callback'});fail(400,'invalid_callback');return true;}
    if(url.searchParams.has('error')) {audit('login_rejected',{reason:'identity_provider_rejected'});fail(401,'identity_provider_rejected');return true;}
    const binding=parseCookies(req)[bindingCookie];
    if(!validBinding(binding)||!url.searchParams.get('code')||!url.searchParams.get('state')) {audit('login_rejected',{reason:'invalid_callback'});fail(400,'invalid_callback');return true;}
    try {
      const verified=await oidcLogin.complete({state:url.searchParams.get('state'),code:url.searchParams.get('code'),browserBinding:binding});
      // Per-subject limit once the verified subject is known. The subject is used only as an in-memory key.
      const subjectDecision=subjectLimiter.take(verified.subject);
      if(!subjectDecision.allowed){audit('login_rate_limited',{scope:'subject'});fail(429,'rate_limited',{'retry-after':String(subjectDecision.retryAfterSeconds)});return true;}
      // MUST recheck current account/membership/entitlement in the application adapter.
      const local=await resolveLocalIdentity({issuer:verified.issuer,subject:verified.subject,applicationId});
      if(!local || !local.authorised || typeof local.localUserId!=='string'||!local.localUserId||typeof local.localAccountId!=='string'||!local.localAccountId||typeof local.organisationId!=='string'||!local.organisationId) {audit('login_denied',{reason:'account_not_authorised'});fail(403,'account_not_authorised');return true;}
      const sessionCookie=await establishSession({applicationId,localUserId:local.localUserId,localAccountId:local.localAccountId,organisationId:local.organisationId,oidcSubject:verified.subject,oidcIssuer:verified.issuer});
      if(typeof sessionCookie!=='string'||!/^([A-Za-z0-9_-]+)=[A-Za-z0-9_-]+;.*Secure;.*HttpOnly;.*SameSite=/i.test(sessionCookie)||/[\r\n]/.test(sessionCookie))throw Error('unsafe_session_cookie');
      res.writeHead(303,{location:afterLogin,'cache-control':'no-store','set-cookie':[clear,sessionCookie]});res.end();
      audit('login_succeeded',{outcome:'allow'});
    }catch(error){
      audit('login_failed',{reason:error?.name==='TitanOidcLoginError'?error.message:'unexpected_error'});
      fail(401,'login_failed');
    }
    return true;
  }

  return async function oidcHttpHandler(req,res) {
    try {return await handle(req,res);}
    catch(error){
      audit('oidc_route_failed',{error_class:errorClass(error)});
      if(!res.headersSent) reply(res,500,{error:'internal_error'});
      else try {res.end();} catch { /* socket already closed */ }
      return true;
    }
  };
}
