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
