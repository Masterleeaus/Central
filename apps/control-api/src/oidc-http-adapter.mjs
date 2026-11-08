/** Framework-neutral OIDC browser route adapter. App-owned sessions stay app-owned.
 * Mount only on exact GET paths and supply trusted local session and account binding.
 */
import { randomBytes } from 'node:crypto';

const allowedApps = new Set(['desk', 'field', 'academy']);
const token = () => randomBytes(32).toString('base64url');
const reply = (res, status, body) => {
  res.writeHead(status, {'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'});
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

/**
 * oidcLogin: Pass 10 flow with Pass 11 state store and ID-token verifier.
 * resolveLocalIdentity: app-owned lookup of issuer + subject, never by email alone.
 * establishSession: app-owned session rotation/creation; returns opaque session cookie.
 * On absent identity, fail closed rather than implicitly creating a privileged account.
 */
export function createOidcHttpAdapter({applicationId,oidcLogin,resolveLocalIdentity,establishSession,afterLogin='/',logger=()=>{}}={}) {
  if(!allowedApps.has(applicationId)||!oidcLogin?.begin||!oidcLogin?.complete||typeof resolveLocalIdentity!=='function'||typeof establishSession!=='function'||typeof afterLogin!=='string'||!afterLogin.startsWith('/')||afterLogin.startsWith('//')||/[\r\n]/.test(afterLogin))throw new TypeError('invalid OIDC route adapter configuration');
  const bindingCookie=`titan_${applicationId}_oidc_binding`;
  return async function oidcHttpHandler(req,res) {
    const url=new URL(req.url??'/', 'http://localhost');
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
        if(authUrl.protocol!=='https:' && !(authUrl.protocol==='http:'&&authUrl.hostname==='localhost'))throw Error('invalid_authorization_url');
        redirect(res,authUrl.href,cookieValue(bindingCookie,binding,600));
      }catch(error){logger('login_begin_failed',error);reply(res,503,{error:'login_unavailable'});}
      return true;
    }
    const clear=clearCookie(bindingCookie);
    const fail=(status,reason)=>{res.writeHead(status,{'cache-control':'no-store','content-type':'application/json','set-cookie':clear});res.end(JSON.stringify({error:reason}));};
    if(Array.from(url.searchParams.keys()).some(k=>!['state','code','error','error_description'].includes(k)||url.searchParams.getAll(k).length!==1)) {fail(400,'invalid_callback');return true;}
    if(url.searchParams.has('error')) {fail(401,'identity_provider_rejected');return true;}
    const binding=parseCookies(req)[bindingCookie];
    if(!validBinding(binding)||!url.searchParams.get('code')||!url.searchParams.get('state')) {fail(400,'invalid_callback');return true;}
    try {
      const verified=await oidcLogin.complete({state:url.searchParams.get('state'),code:url.searchParams.get('code'),browserBinding:binding});
      // MUST recheck current account/membership/entitlement in the application adapter.
      const local=await resolveLocalIdentity({issuer:verified.issuer,subject:verified.subject,applicationId});
      if(!local || !local.authorised || typeof local.localUserId!=='string'||!local.localUserId||typeof local.localAccountId!=='string'||!local.localAccountId||typeof local.organisationId!=='string'||!local.organisationId) {fail(403,'account_not_authorised');return true;}
      const sessionCookie=await establishSession({applicationId,localUserId:local.localUserId,localAccountId:local.localAccountId,organisationId:local.organisationId,oidcSubject:verified.subject,oidcIssuer:verified.issuer});
      if(typeof sessionCookie!=='string'||!/^([A-Za-z0-9_-]+)=[A-Za-z0-9_-]+;.*Secure;.*HttpOnly;.*SameSite=/i.test(sessionCookie)||/[\r\n]/.test(sessionCookie))throw Error('unsafe_session_cookie');
      res.writeHead(303,{location:afterLogin,'cache-control':'no-store','set-cookie':[clear,sessionCookie]});res.end();
    }catch(error){logger('login_callback_failed',error);fail(401,'login_failed');}
    return true;
  };
}
