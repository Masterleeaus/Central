/** OIDC RP-initiated (global) logout. Builds Logto's end_session URL with id_token_hint,
 * an exact-match registered post_logout_redirect_uri and an anti-CSRF state, and revokes
 * every local app session for the user before the browser is sent to Logto.
 * No network calls are made here. The id_token_hint must come from the server-side session. */
import {randomBytes,timingSafeEqual} from 'node:crypto';
const APPS=['desk','field','academy'];
const ID=/^[A-Za-z0-9:_-]{1,200}$/;
const STATE=/^[A-Za-z0-9_-]{32,256}$/;
const ID_TOKEN_HINT=/^[A-Za-z0-9._-]{1,8192}$/;
const canonicalHttps=value=>{
  if(typeof value!=='string')return false;
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.href===value;}catch{return false;}
};

export function createGlobalLogout({issuer,postLogoutRedirectUris,revocations,randomState=()=>randomBytes(32).toString('base64url')}={}) {
  if(!canonicalHttps(issuer)||new URL(issuer).search)throw new TypeError('invalid OIDC issuer');
  if(!Array.isArray(postLogoutRedirectUris)||postLogoutRedirectUris.length<1||postLogoutRedirectUris.length>20||!postLogoutRedirectUris.every(canonicalHttps))throw new TypeError('registered post-logout URIs required');
  if(typeof revocations?.revokeAll!=='function')throw new TypeError('revocation store required');
  if(typeof randomState!=='function')throw new TypeError('invalid state generator');
  const registered=new Set(postLogoutRedirectUris);
  const endSessionEndpoint=`${issuer.replace(/\/+$/,'')}/session/end`;

  /** Builds the Logto end_session URL. Exact string match against registered URIs only. */
  function buildEndSessionUrl({idTokenHint,postLogoutRedirectUri,state}={}){
    if(typeof idTokenHint!=='string'||!ID_TOKEN_HINT.test(idTokenHint))throw new TypeError('invalid id_token_hint');
    if(!registered.has(postLogoutRedirectUri))throw new TypeError('unregistered post-logout redirect URI');
    const finalState=state===undefined?randomState():state;
    if(typeof finalState!=='string'||!STATE.test(finalState))throw new TypeError('invalid logout state');
    const url=new URL(endSessionEndpoint);
    url.searchParams.set('id_token_hint',idTokenHint);
    url.searchParams.set('post_logout_redirect_uri',postLogoutRedirectUri);
    url.searchParams.set('state',finalState);
    return {url:url.href,state:finalState};
  }

  /** Revokes local sessions for every (subject, organisation) pair across all apps, then
   * returns the Logto redirect. If any revocation fails, no redirect is produced. */
  async function logout({idTokenHint,postLogoutRedirectUri,scopes,state}={}){
    if(!Array.isArray(scopes)||scopes.length<1||scopes.length>128||!scopes.every(s=>ID.test(s?.logtoSubject)&&ID.test(s?.organisationId)))throw new TypeError('invalid logout scopes');
    const built=buildEndSessionUrl({idTokenHint,postLogoutRedirectUri,state});
    let revoked=0;
    for(const scope of scopes)for(const applicationId of APPS){
      const generation=await revocations.revokeAll({applicationId,logtoSubject:scope.logtoSubject,organisationId:scope.organisationId});
      if(!Number.isSafeInteger(generation)||generation<1)throw new Error('revocation not confirmed');
      revoked++;
    }
    return {location:built.url,state:built.state,revoked};
  }

  return {buildEndSessionUrl,logout};
}

/** Constant-time check of the state returned on the post-logout redirect. */
export function verifyLogoutState(expected,returned){
  if(typeof expected!=='string'||typeof returned!=='string')return false;
  const a=Buffer.from(expected),b=Buffer.from(returned);
  return a.length===b.length&&timingSafeEqual(a,b);
}

/** HTTP route for RP-initiated global logout: POST /auth/titan/global-logout.
 * Why POST: revoking sessions is state-changing, and a GET would let any page sign the user out
 * (the same reason oidc-app-session.mjs refuses GET logout). GET on this path returns 405.
 * The POST must come from an allowed application origin with Sec-Fetch-Site same-origin or same-site.
 * The post-logout redirect is a fixed registered URI from config, never read from the request.
 * Order: origin check, authenticate caller, revoke every app (fails closed), then 303 to Logto. */
export const GLOBAL_LOGOUT_PATH='/auth/titan/global-logout';
const STATE_COOKIE='titan_global_logout_state';
const SESSION_COOKIE=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const setCookie=(name,value,maxAge)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/**
 * globalLogout: object returned by createGlobalLogout (revocations and Logto URL builder injected there).
 * authenticateSession(req): app-owned lookup of the caller's server-side session. Resolves to
 *   {idTokenHint, scopes:[{logtoSubject, organisationId}]} or null. Never trusts client-supplied subjects.
 * postLogoutRedirectUri: must be one of the registered URIs passed to createGlobalLogout (checked here at startup).
 * allowedOrigins: exact application origins allowed to POST this route.
 * sessionCookieName: the cookie the caller's session travels in; cleared on successful logout.
 * Returns (req,res) => Promise<boolean>; false means the path is not this route.
 */
export function createGlobalLogoutHandler({globalLogout,authenticateSession,postLogoutRedirectUri,allowedOrigins,sessionCookieName,logger=()=>{}}={}) {
  if(typeof globalLogout?.logout!=='function'||typeof globalLogout?.buildEndSessionUrl!=='function')throw new TypeError('global logout required');
  if(typeof authenticateSession!=='function')throw new TypeError('session authenticator required');
  if(typeof sessionCookieName!=='string'||!SESSION_COOKIE.test(sessionCookieName))throw new TypeError('invalid session cookie name');
  if(!Array.isArray(allowedOrigins)||allowedOrigins.length<1||allowedOrigins.length>10||!allowedOrigins.every(o=>typeof o==='string'&&/^https:\/\/[A-Za-z0-9.-]{1,253}$/.test(o)&&new URL(o).origin===o))throw new TypeError('invalid allowed origins');
  // Throws unless postLogoutRedirectUri is registered; no request is needed to check this.
  globalLogout.buildEndSessionUrl({idTokenHint:'t.t.t',postLogoutRedirectUri});
  const origins=new Set(allowedOrigins);
  const send=(res,status,error,extra={})=>{res.writeHead(status,{'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff',...extra});res.end(JSON.stringify({error}));};

  return async function globalLogoutHttpHandler(req,res){
    let pathname;
    try{pathname=new URL(req.url??'/','http://localhost').pathname;}catch{return false;}
    if(pathname!==GLOBAL_LOGOUT_PATH)return false;
    if(req.method!=='POST'){send(res,405,'method_not_allowed',{allow:'POST'});return true;}
    const origin=req.headers?.origin;
    const site=req.headers?.['sec-fetch-site'];
    if(typeof origin!=='string'||!origins.has(origin)||typeof site!=='string'||!['same-origin','same-site'].includes(site)){send(res,403,'origin_denied');return true;}
    try{
      const session=await authenticateSession(req);
      if(!session||typeof session.idTokenHint!=='string'||!Array.isArray(session.scopes)){send(res,401,'unauthenticated');return true;}
      const {location,state,revoked}=await globalLogout.logout({idTokenHint:session.idTokenHint,postLogoutRedirectUri,scopes:session.scopes});
      res.writeHead(303,{location,'cache-control':'no-store','set-cookie':[setCookie(sessionCookieName,'',0),setCookie(STATE_COOKIE,state,300)]});
      res.end();
      logger('global_logout_started',{revoked});
    }catch(error){
      logger('global_logout_failed',{error_class:typeof error?.name==='string'?error.name:'unknown'});
      send(res,503,'logout_unavailable');
    }
    return true;
  };
}
