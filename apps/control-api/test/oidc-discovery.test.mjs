import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOidcLogin,TitanOidcLoginError} from '../src/oidc-login.mjs';

const binding='b'.repeat(42), clientId='desk-client', clientSecret='secret';
const redirectUri='https://desk.titanzero.io/auth/callback';
const ORIGIN='https://identity.titanzero.io';
const DISCOVERY='/.well-known/openid-configuration';
const tokenBody={id_token:'jwt.token.signature',access_token:'abcdef',token_type:'Bearer'};
const metadataFor=(iss,overrides={},base=iss)=>({issuer:iss,authorization_endpoint:`${base}/oidc/auth`,token_endpoint:`${base}/oidc/token`,...overrides});
const jsonResponse=obj=>({ok:true,redirected:false,json:async()=>obj,text:async()=>JSON.stringify(obj)});
const tokenResponse=()=>({ok:true,json:async()=>tokenBody});

/** Builds a login whose fetcher serves discovery (from discoveryFor) and token exchanges, recording every call. No network. */
function harness({issuer=ORIGIN,discoveryFor=()=>jsonResponse(metadataFor(issuer)),tokenFor=()=>tokenResponse(),...options}={}){
  let now=1_800_000_000_000;const pending=new Map();let nonce;
  const seen={discovery:[],token:[]};
  const loginStore={save:async(k,v)=>{pending.set(k,v)},consume:async(k)=>{const v=pending.get(k);pending.delete(k);return v}};
  const fetcher=async(url,request)=>{
    const u=String(url);
    if(u.endsWith(DISCOVERY)){seen.discovery.push({url:u,request});return discoveryFor(u,request);}
    seen.token.push({url:u,request});return tokenFor(u,request);
  };
  const verifyIdToken=async()=>({iss:issuer,aud:clientId,sub:'user-1',nonce,exp:Math.floor(now/1000)+60});
  const login=createOidcLogin({issuer,clientId,clientSecret,redirectUri,loginStore,fetcher,verifyIdToken,clock:()=>now,...options});
  const begin=async()=>{const a=await login.begin({browserBinding:binding});const u=new URL(a.authorizationUrl);nonce=u.searchParams.get('nonce');return {url:u,state:u.searchParams.get('state')};};
  return {login,seen,begin,advance:ms=>{now+=ms;},complete:(state)=>login.complete({state,code:'example-code',browserBinding:binding})};
}

test('origin-only issuer: endpoints come from metadata and discovery is at the issuer well-known path',async()=>{
  const h=harness();
  const {url,state}=await h.begin();
  assert.equal(url.origin+url.pathname,`${ORIGIN}/oidc/auth`);
  assert.equal(h.seen.discovery[0].url,`${ORIGIN}${DISCOVERY}`);
  assert.equal(h.seen.discovery[0].request.redirect,'error');
  const result=await h.complete(state);
  assert.equal(result.subject,'user-1');
  assert.equal(h.seen.token[0].url,`${ORIGIN}/oidc/token`);
});

test('issuer with a path (Logto /oidc shape): no doubled path segments',async()=>{
  const issuer=`${ORIGIN}/oidc`;
  const h=harness({issuer,discoveryFor:()=>jsonResponse(metadataFor(issuer,{},ORIGIN))});
  const {url,state}=await h.begin();
  assert.equal(url.origin+url.pathname,`${ORIGIN}/oidc/auth`);
  assert.equal(h.seen.discovery[0].url,`${ORIGIN}/oidc${DISCOVERY}`);
  await h.complete(state);
  assert.equal(h.seen.token[0].url,`${ORIGIN}/oidc/token`);
  assert.ok(!h.seen.token[0].url.includes('/oidc/oidc'));
});

test('endpoints are taken from metadata, not derived from the issuer path',async()=>{
  const h=harness({discoveryFor:()=>jsonResponse(metadataFor(ORIGIN,{token_endpoint:`${ORIGIN}/oauth/token`}))});
  const {state}=await h.begin();
  await h.complete(state);
  assert.equal(h.seen.token[0].url,`${ORIGIN}/oauth/token`);
});

test('mismatched metadata issuer is rejected (trailing slash differs)',async()=>{
  const h=harness({discoveryFor:()=>jsonResponse(metadataFor(`${ORIGIN}/`))});
  await assert.rejects(h.begin(),(e)=>e instanceof TitanOidcLoginError&&e.message==='discovery_invalid');
});

test('metadata for a different issuer is rejected',async()=>{
  const h=harness({discoveryFor:()=>jsonResponse(metadataFor('https://evil.example'))});
  await assert.rejects(h.begin(),/discovery_invalid/);
});

test('http authorization endpoint is rejected',async()=>{
  const h=harness({discoveryFor:()=>jsonResponse(metadataFor(ORIGIN,{authorization_endpoint:'http://identity.titanzero.io/oidc/auth'}))});
  await assert.rejects(h.begin(),/discovery_invalid/);
});

test('http token endpoint is rejected even when authorization endpoint is https',async()=>{
  const h=harness({discoveryFor:()=>jsonResponse(metadataFor(ORIGIN,{token_endpoint:'http://identity.titanzero.io/oidc/token'}))});
  await assert.rejects(h.begin(),/discovery_invalid/);
});

test('endpoint with credentials or a fragment is rejected',async()=>{
  const h=harness({discoveryFor:()=>jsonResponse(metadataFor(ORIGIN,{token_endpoint:'https://user:pw@identity.titanzero.io/oidc/token'}))});
  await assert.rejects(h.begin(),/discovery_invalid/);
});

test('cross-origin token endpoint is rejected and no token exchange happens',async()=>{
  const h=harness({discoveryFor:()=>jsonResponse(metadataFor(ORIGIN,{token_endpoint:'https://evil.example/oidc/token'}))});
  await assert.rejects(h.begin(),/discovery_invalid/);
  assert.equal(h.seen.token.length,0);
});

test('cross-origin authorization endpoint is rejected',async()=>{
  const h=harness({discoveryFor:()=>jsonResponse(metadataFor(ORIGIN,{authorization_endpoint:'https://evil.example/oidc/auth'}))});
  await assert.rejects(h.begin(),/discovery_invalid/);
});

test('explicitly allow-listed endpoint origin is accepted',async()=>{
  const h=harness({
    allowedEndpointOrigins:['https://auth-edge.titanzero.io'],
    discoveryFor:()=>jsonResponse(metadataFor(ORIGIN,{token_endpoint:'https://auth-edge.titanzero.io/oidc/token'}))
  });
  const {state}=await h.begin();
  await h.complete(state);
  assert.equal(h.seen.token[0].url,'https://auth-edge.titanzero.io/oidc/token');
});

test('allow-list entries must be bare secure origins',()=>{
  for(const bad of ['https://auth.titanzero.io/oidc','http://auth.titanzero.io','auth.titanzero.io','https://auth.titanzero.io/'])
    assert.throws(()=>harness({allowedEndpointOrigins:[bad]}),/invalid allowed endpoint origin/);
});

test('localhost issuer with the dev flag: http localhost endpoints accepted',async()=>{
  const issuer='http://localhost:9000/oidc';
  const h=harness({issuer,allowInsecureLocalhost:true,redirectUri:'http://localhost:9000/auth/callback',discoveryFor:()=>jsonResponse(metadataFor(issuer,{},'http://localhost:9000'))});
  const {url,state}=await h.begin();
  assert.equal(url.origin+url.pathname,'http://localhost:9000/oidc/auth');
  await h.complete(state);
  assert.equal(h.seen.token[0].url,'http://localhost:9000/oidc/token');
});

test('redirect during discovery is rejected (fetch redirect:error throws)',async()=>{
  const h=harness({discoveryFor:()=>{throw new TypeError('redirect mode is set to error')}});
  await assert.rejects(h.begin(),/discovery_unavailable/);
});

test('discovery response that was redirected is rejected',async()=>{
  const h=harness({discoveryFor:()=>({...jsonResponse(metadataFor(ORIGIN)),redirected:true})});
  await assert.rejects(h.begin(),/discovery_unavailable/);
});

test('non-2xx discovery response is rejected',async()=>{
  const h=harness({discoveryFor:()=>({ok:false,status:500,redirected:false,text:async()=>''})});
  await assert.rejects(h.begin(),/discovery_unavailable/);
});

test('oversized discovery body (streamed, no content-length) is rejected',async()=>{
  const big=JSON.stringify({...metadataFor(ORIGIN),padding:'x'.repeat(70_000)});
  const h=harness({discoveryFor:()=>new Response(big,{headers:{'content-type':'application/json'}})});
  await assert.rejects(h.begin(),/discovery_too_large/);
});

test('oversized discovery body (declared content-length) is rejected before reading',async()=>{
  const h=harness({discoveryFor:()=>({ok:true,redirected:false,headers:new Headers({'content-length':'1000000'}),text:async()=>{throw new Error('must not read')}})});
  await assert.rejects(h.begin(),/discovery_too_large/);
});

test('discovery body within the limit is accepted (real Response)',async()=>{
  const h=harness({discoveryFor:()=>new Response(JSON.stringify(metadataFor(ORIGIN)),{headers:{'content-type':'application/json'}})});
  const {url}=await h.begin();
  assert.equal(url.origin+url.pathname,`${ORIGIN}/oidc/auth`);
});

test('non-JSON discovery body is rejected',async()=>{
  const h=harness({discoveryFor:()=>new Response('<html>not json</html>')});
  await assert.rejects(h.begin(),/discovery_invalid/);
});

test('metadata missing an endpoint is rejected',async()=>{
  const {token_endpoint,...partial}=metadataFor(ORIGIN);
  const h=harness({discoveryFor:()=>jsonResponse(partial)});
  await assert.rejects(h.begin(),/discovery_invalid/);
});

test('discovery that never answers times out',async()=>{
  const h=harness({timeoutMs:500,discoveryFor:(u,request)=>new Promise(()=>{})});
  const started=Date.now();
  await assert.rejects(h.begin(),/discovery_timeout/);
  const elapsed=Date.now()-started;
  assert.ok(elapsed>=450&&elapsed<5000,`elapsed ${elapsed}`);
});

test('discovery request carries a timeout signal',async()=>{
  const h=harness();
  await h.begin();
  assert.ok(h.seen.discovery[0].request.headers&&h.seen.discovery[0].request.redirect==='error');
});

test('metadata is cached within the TTL and refetched after it',async()=>{
  const h=harness({discoveryCacheTtlMs:60_000});
  await h.begin();await h.begin();
  assert.equal(h.seen.discovery.length,1);
  h.advance(59_000);await h.begin();
  assert.equal(h.seen.discovery.length,1);
  h.advance(2_000);await h.begin();
  assert.equal(h.seen.discovery.length,2);
});

test('concurrent logins share one discovery fetch',async()=>{
  const h=harness();
  await Promise.all([h.begin(),h.begin(),h.begin()]);
  assert.equal(h.seen.discovery.length,1);
});

test('failed discovery is not cached',async()=>{
  let fail=true;
  const h=harness({discoveryFor:()=>{if(fail){fail=false;throw new TypeError('offline')}return jsonResponse(metadataFor(ORIGIN))}});
  await assert.rejects(h.begin(),/discovery_unavailable/);
  await h.begin();
  assert.equal(h.seen.discovery.length,2);
});

test('discovery cache TTL is bounded',()=>{
  assert.throws(()=>harness({discoveryCacheTtlMs:1000}),/invalid OIDC login dependencies/);
  assert.throws(()=>harness({discoveryCacheTtlMs:86_400_000}),/invalid OIDC login dependencies/);
});
