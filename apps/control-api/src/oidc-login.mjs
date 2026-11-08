/** Titan Central reusable OIDC Authorization Code + PKCE login flow.
 * Does not modify Logto or implicitly install routes in Supercharged, Sorted or Academy.
 * Each application must inject durable, shared, atomic one-use state storage and
 * independently secure HttpOnly SameSite session handling.
 */
import {randomBytes, createHash} from 'node:crypto';

export class TitanOidcLoginError extends Error {
  constructor(message='oidc_login_failed'){super(message);this.name='TitanOidcLoginError';}
}
const safeString = value => typeof value==='string' && value.length>0 && value.length<=4096 && !/[\r\n]/.test(value);
const strictUrl=(value,allowLocal=false)=>{
  if(!safeString(value))throw new TypeError('missing OIDC URL');
  const url=new URL(value);
  if(url.username||url.password||url.hash||url.search || !(url.protocol==='https:' || (allowLocal&&url.protocol==='http:'&&url.hostname==='localhost')))throw new TypeError('invalid OIDC URL');
  return url;
};
const b64=buf=>Buffer.from(buf).toString('base64url');
const sha=value=>b64(createHash('sha256').update(value).digest());
const random=()=>b64(randomBytes(32));
/** The storage adapter must atomically delete and return pending state exactly once. */
export function createOidcLogin({issuer,clientId,clientSecret,redirectUri,loginStore,verifyIdToken,fetcher=fetch,clock=()=>Date.now(),stateTtlMs=300_000,timeoutMs=5000}={}) {
  const oidcIssuer=strictUrl(issuer,true);
  const redirect=strictUrl(redirectUri,true);
  const authorize=new URL('oidc/auth',oidcIssuer.href.endsWith('/')?oidcIssuer.href:oidcIssuer.href+'/');
  const tokenEndpoint=new URL('oidc/token',oidcIssuer.href.endsWith('/')?oidcIssuer.href:oidcIssuer.href+'/');
  if(!safeString(clientId)||!safeString(clientSecret)||!loginStore||typeof loginStore.save!=='function'||typeof loginStore.consume!=='function'||typeof verifyIdToken!=='function'||!Number.isInteger(stateTtlMs)||stateTtlMs<60_000||stateTtlMs>600_000||!Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>15000)throw new TypeError('invalid OIDC login dependencies');
  if(redirect.origin!==oidcIssuer.origin&&redirect.protocol!=='https:')throw new TypeError('insecure cross-origin callback');
  return {
    async begin({browserBinding}={}) {
      // Binding is a server-generated signed, HttpOnly, SameSite browser correlation token;
      // never accept this value from query parameters or request bodies.
      if(!safeString(browserBinding)||browserBinding.length<32)throw new TitanOidcLoginError('invalid_browser_binding');
      const state=random(),nonce=random(),verifier=random();
      const expiresAt=clock()+stateTtlMs;
      await loginStore.save(state,{nonce,verifier,bindingHash:sha(browserBinding),expiresAt});
      const uri=new URL(authorize);
      for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:redirect.href,response_type:'code',scope:'openid profile email',state,nonce,code_challenge:sha(verifier),code_challenge_method:'S256'}))uri.searchParams.set(key,value);
      return {authorizationUrl:uri.href,expiresAt};
    },
    async complete({state,code,browserBinding}={}) {
      if(!safeString(state)||state.length>256||!safeString(code)||!safeString(browserBinding)||browserBinding.length<32)throw new TitanOidcLoginError();
      // No token exchange until state is atomically consumed and bound to the same browser.
      const transaction=await loginStore.consume(state);
      if(!transaction || !Number.isSafeInteger(transaction.expiresAt)||transaction.expiresAt<=clock() || transaction.bindingHash!==sha(browserBinding)||!safeString(transaction.nonce)||!safeString(transaction.verifier))throw new TitanOidcLoginError('state_expired_or_invalid');
      const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirect.href,code_verifier:transaction.verifier});
      const credential=Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      let response;
      try { response=await fetcher(tokenEndpoint.href,{method:'POST',headers:{authorization:`Basic ${credential}`,'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:body.toString(),redirect:'error',signal:AbortSignal.timeout(timeoutMs)}); }
      catch { throw new TitanOidcLoginError('token_exchange_unavailable'); }
      if(!response.ok)throw new TitanOidcLoginError('token_exchange_rejected');
      let tokens;
      try {tokens=await response.json();}catch{throw new TitanOidcLoginError('invalid_token_response');}
      if(!tokens || !safeString(tokens.id_token)||tokens.id_token.length>16384||!safeString(tokens.access_token)||tokens.access_token.length>16384 || tokens.token_type?.toLowerCase()!=='bearer')throw new TitanOidcLoginError('invalid_token_response');
      // verifyIdToken must perform signature/JWKS, iss, aud, exp, iat and azp checks.
      // Never parse claims without verification; nonce is mandatory here.
      let principal;
      try { principal=await verifyIdToken(tokens.id_token); }catch{throw new TitanOidcLoginError('invalid_identity_token');}
      if(!principal || !safeString(principal.sub)||principal.nonce!==transaction.nonce || principal.iss!==issuer || !(principal.aud===clientId||(Array.isArray(principal.aud)&&principal.aud.includes(clientId))) || !Number.isSafeInteger(principal.exp)||principal.exp<=Math.floor(clock()/1000))throw new TitanOidcLoginError('invalid_identity_claims');
      return {subject:principal.sub,issuer:principal.iss,verifiedAt:new Date(clock()).toISOString()};
    }
  };
}
