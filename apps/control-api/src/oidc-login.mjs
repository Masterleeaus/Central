/** Titan Central reusable OIDC Authorization Code + PKCE login flow.
 * Does not modify Logto or implicitly install routes in Desk, Field or Academy.
 * Each application must inject durable, shared, atomic one-use state storage and
 * independently secure HttpOnly SameSite session handling.
 *
 * Authorization and token endpoints come only from OpenID Provider metadata at
 * {issuer}/.well-known/openid-configuration. Their paths are never derived from the issuer.
 */
import {randomBytes, createHash} from 'node:crypto';
import {insecureLocalhostAllowed, isSecureEndpoint} from './endpoint-policy.mjs';

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
const DISCOVERY_SUFFIX='/.well-known/openid-configuration';

/** Validates one endpoint from discovery metadata: transport, no credentials or fragments,
 * and origin either equal to the configured issuer's origin or explicitly allow-listed. */
function trustedEndpoint(value,{allowLocal,trustedOrigins}){
  if(!safeString(value)||!isSecureEndpoint(value,allowLocal))throw new TitanOidcLoginError('discovery_invalid');
  const url=new URL(value);
  if(url.username||url.password||url.hash||url.search||!trustedOrigins.has(url.origin))throw new TitanOidcLoginError('discovery_invalid');
  return url.href;
}

/** Reads a response body as text, failing as soon as it exceeds maxBytes. */
async function readBoundedText(response,maxBytes){
  const declared=response.headers?.get?.('content-length');
  if(declared!=null && Number(declared)>maxBytes)throw new TitanOidcLoginError('discovery_too_large');
  if(response.body && typeof response.body.getReader==='function'){
    const reader=response.body.getReader();
    const chunks=[];let size=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){await reader.cancel().catch(()=>{});throw new TitanOidcLoginError('discovery_too_large');}
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if(typeof response.text==='function'){
    const text=await response.text();
    if(typeof text!=='string' || Buffer.byteLength(text)>maxBytes)throw new TitanOidcLoginError(typeof text==='string'?'discovery_too_large':'discovery_invalid');
    return text;
  }
  throw new TitanOidcLoginError('discovery_invalid');
}

/** The storage adapter must atomically delete and return pending state exactly once. */
export function createOidcLogin({issuer,clientId,clientSecret,redirectUri,loginStore,verifyIdToken,fetcher=fetch,clock=()=>Date.now(),stateTtlMs=300_000,timeoutMs=5000,allowInsecureLocalhost=insecureLocalhostAllowed(),allowedEndpointOrigins=[],discoveryCacheTtlMs=300_000,maxDiscoveryBytes=65_536}={}) {
  // http://localhost is accepted only when allowInsecureLocalhost is set (TITAN_ALLOW_INSECURE_LOCALHOST=1).
  const oidcIssuer=strictUrl(issuer,allowInsecureLocalhost);
  const redirect=strictUrl(redirectUri,allowInsecureLocalhost);
  if(!safeString(clientId)||!safeString(clientSecret)||!loginStore||typeof loginStore.save!=='function'||typeof loginStore.consume!=='function'||typeof verifyIdToken!=='function'||!Number.isInteger(stateTtlMs)||stateTtlMs<60_000||stateTtlMs>600_000||!Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>15000||!Number.isInteger(discoveryCacheTtlMs)||discoveryCacheTtlMs<60_000||discoveryCacheTtlMs>3_600_000||!Number.isInteger(maxDiscoveryBytes)||maxDiscoveryBytes<4096||maxDiscoveryBytes>262_144||!Array.isArray(allowedEndpointOrigins))throw new TypeError('invalid OIDC login dependencies');
  if(redirect.origin!==oidcIssuer.origin&&redirect.protocol!=='https:')throw new TypeError('insecure cross-origin callback');
  const trustedOrigins=new Set([oidcIssuer.origin]);
  for(const origin of allowedEndpointOrigins){
    let parsed;
    try{parsed=new URL(origin);}catch{throw new TypeError('invalid allowed endpoint origin');}
    if(parsed.origin!==origin||!isSecureEndpoint(origin,allowInsecureLocalhost))throw new TypeError('invalid allowed endpoint origin');
    trustedOrigins.add(origin);
  }
  const discoveryUrl=new URL(oidcIssuer.href.replace(/\/+$/,'')+DISCOVERY_SUFFIX);
  const allowLocal=allowInsecureLocalhost;

  /** Runs work under a hard deadline; the signal is aborted when the deadline passes. */
  function withDeadline(work){
    const controller=new AbortController();let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new TitanOidcLoginError('discovery_timeout'));},timeoutMs);});
    return Promise.race([work(controller.signal),deadline]).finally(()=>clearTimeout(timer));
  }

  async function fetchMetadata(){
    return withDeadline(async signal=>{
      let response;
      try{response=await fetcher(discoveryUrl.href,{method:'GET',headers:{accept:'application/json'},redirect:'error',signal});}
      catch{throw new TitanOidcLoginError('discovery_unavailable');}
      if(!response||!response.ok||response.redirected===true)throw new TitanOidcLoginError('discovery_unavailable');
      let text;
      try{text=await readBoundedText(response,maxDiscoveryBytes);}
      catch(error){throw error instanceof TitanOidcLoginError?error:new TitanOidcLoginError('discovery_unavailable');}
      try{return JSON.parse(text);}catch{throw new TitanOidcLoginError('discovery_invalid');}
    });
  }

  async function discover(){
    const metadata=await fetchMetadata();
    // Exact string match: the provider must identify itself as the configured issuer.
    if(!metadata||typeof metadata!=='object'||metadata.issuer!==issuer)throw new TitanOidcLoginError('discovery_invalid');
    return {
      authorizationEndpoint:trustedEndpoint(metadata.authorization_endpoint,{allowLocal,trustedOrigins}),
      tokenEndpoint:trustedEndpoint(metadata.token_endpoint,{allowLocal,trustedOrigins})
    };
  }

  let cache=null;let inflight=null;
  /** Cached metadata endpoints; concurrent callers share one discovery fetch. Failures are not cached. */
  function resolveEndpoints(){
    if(cache && clock()<cache.expiresAt)return Promise.resolve(cache.endpoints);
    if(!inflight){
      inflight=discover()
        .then(endpoints=>{cache={endpoints,expiresAt:clock()+discoveryCacheTtlMs};return endpoints;})
        .finally(()=>{inflight=null;});
    }
    return inflight;
  }

  return {
    async begin({browserBinding}={}) {
      // Binding is a server-generated signed, HttpOnly, SameSite browser correlation token;
      // never accept this value from query parameters or request bodies.
      if(!safeString(browserBinding)||browserBinding.length<32)throw new TitanOidcLoginError('invalid_browser_binding');
      const {authorizationEndpoint}=await resolveEndpoints();
      const state=random(),nonce=random(),verifier=random();
      const expiresAt=clock()+stateTtlMs;
      await loginStore.save(state,{nonce,verifier,bindingHash:sha(browserBinding),expiresAt});
      const uri=new URL(authorizationEndpoint);
      for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:redirect.href,response_type:'code',scope:'openid profile email',state,nonce,code_challenge:sha(verifier),code_challenge_method:'S256'}))uri.searchParams.set(key,value);
      return {authorizationUrl:uri.href,expiresAt};
    },
    async complete({state,code,browserBinding}={}) {
      if(!safeString(state)||state.length>256||!safeString(code)||!safeString(browserBinding)||browserBinding.length<32)throw new TitanOidcLoginError();
      // No token exchange until state is atomically consumed and bound to the same browser.
      const transaction=await loginStore.consume(state);
      if(!transaction || !Number.isSafeInteger(transaction.expiresAt)||transaction.expiresAt<=clock() || transaction.bindingHash!==sha(browserBinding)||!safeString(transaction.nonce)||!safeString(transaction.verifier))throw new TitanOidcLoginError('state_expired_or_invalid');
      const {tokenEndpoint}=await resolveEndpoints();
      const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirect.href,code_verifier:transaction.verifier});
      const credential=Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      let response;
      try { response=await fetcher(tokenEndpoint,{method:'POST',headers:{authorization:`Basic ${credential}`,'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:body.toString(),redirect:'error',signal:AbortSignal.timeout(timeoutMs)}); }
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
      // idToken is the verified raw token, returned only so the app adapter can seal it for logout (issue #6). Never logged.
      return {subject:principal.sub,issuer:principal.iss,verifiedAt:new Date(clock()).toISOString(),idToken:tokens.id_token};
    }
  };
}
