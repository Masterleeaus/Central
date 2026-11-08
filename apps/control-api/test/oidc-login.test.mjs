import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOidcLogin,TitanOidcLoginError} from '../src/oidc-login.mjs';
const binding='b'.repeat(42), issuer='https://identity.titanzero.io',clientId='desk-client';
const setup=(options={})=>{
 let now=1_800_000_000_000;const pending=new Map();let calls=0;
 const loginStore={save:async(k,v)=>{pending.set(k,v)},consume:async(k)=>{const v=pending.get(k);pending.delete(k);return v}};
 let observed;
 const fetcher=async(u,request)=>{calls++;observed={url:u,request};return {ok:true,json:async()=>({id_token:'jwt.token.signature',access_token:'abcdef',token_type:'Bearer'})}};
 let nonce;
 const verifyIdToken=async()=>({iss:issuer,aud:clientId,sub:'logto-user',nonce,exp:Math.floor(now/1000)+60});
 const login=createOidcLogin({issuer,clientId,clientSecret:'secret',redirectUri:'https://desk.titanzero.io/auth/callback',loginStore,fetcher,verifyIdToken,clock:()=>now,...options});
 return {login,pending,get calls(){return calls},get observed(){return observed},setNow:(v)=>{now=v},setNonce:v=>{nonce=v}};
};
test('begin includes code S256, state, nonce and exact registered callback',async()=>{const s=setup();const a=await s.login.begin({browserBinding:binding});const u=new URL(a.authorizationUrl);assert.equal(u.pathname,'/oidc/auth');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('redirect_uri'),'https://desk.titanzero.io/auth/callback');assert.equal(u.searchParams.get('response_type'),'code');assert.ok(u.searchParams.get('nonce'));assert.ok(u.searchParams.get('state'));assert.ok(u.searchParams.get('code_challenge'));assert.equal(s.pending.size,1);});
test('valid callback consumes state and verifies ID token nonce',async()=>{const s=setup();const a=await s.login.begin({browserBinding:binding});const u=new URL(a.authorizationUrl);s.setNonce(u.searchParams.get('nonce'));const result=await s.login.complete({state:u.searchParams.get('state'),code:'example-code',browserBinding:binding});assert.equal(result.subject,'logto-user');assert.equal(s.calls,1);assert.equal(s.observed.url,'https://identity.titanzero.io/oidc/token');assert.equal(new URLSearchParams(s.observed.request.body).get('code_verifier').length>20,true);});
test('replay state rejected',async()=>{const s=setup();const u=new URL((await s.login.begin({browserBinding:binding})).authorizationUrl);s.setNonce(u.searchParams.get('nonce'));const args={state:u.searchParams.get('state'),code:'abc',browserBinding:binding};await s.login.complete(args);await assert.rejects(s.login.complete(args),TitanOidcLoginError);assert.equal(s.calls,1);});
test('different browser rejected before exchange',async()=>{const s=setup();const u=new URL((await s.login.begin({browserBinding:binding})).authorizationUrl);await assert.rejects(s.login.complete({state:u.searchParams.get('state'),code:'abc',browserBinding:'c'.repeat(42)}),TitanOidcLoginError);assert.equal(s.calls,0);});
test('expired state rejected',async()=>{const s=setup();const u=new URL((await s.login.begin({browserBinding:binding})).authorizationUrl);s.setNow(1_800_000_400_000);await assert.rejects(s.login.complete({state:u.searchParams.get('state'),code:'abc',browserBinding:binding}),TitanOidcLoginError);assert.equal(s.calls,0);});
test('nonce mismatch rejected',async()=>{const s=setup();const u=new URL((await s.login.begin({browserBinding:binding})).authorizationUrl);s.setNonce('wrong');await assert.rejects(s.login.complete({state:u.searchParams.get('state'),code:'abc',browserBinding:binding}),TitanOidcLoginError);});
test('invalid issuer rejected',async()=>{const s=setup({verifyIdToken:async()=>({sub:'ok',iss:'https://evil.test',aud:clientId,nonce:'bad',exp:2000000000})});const u=new URL((await s.login.begin({browserBinding:binding})).authorizationUrl);await assert.rejects(s.login.complete({state:u.searchParams.get('state'),code:'abc',browserBinding:binding}),TitanOidcLoginError);});
test('invalid audience rejected',async()=>{const s=setup({verifyIdToken:async()=>({sub:'ok',iss:issuer,aud:'other',nonce:'bad',exp:2000000000})});const u=new URL((await s.login.begin({browserBinding:binding})).authorizationUrl);await assert.rejects(s.login.complete({state:u.searchParams.get('state'),code:'abc',browserBinding:binding}),TitanOidcLoginError);});
test('network failure fails closed',async()=>{const s=setup({fetcher:async()=>{throw Error('offline')}});const u=new URL((await s.login.begin({browserBinding:binding})).authorizationUrl);await assert.rejects(s.login.complete({state:u.searchParams.get('state'),code:'abc',browserBinding:binding}),/token_exchange_unavailable/);});
test('rejects invalid browser binding',async()=>{const s=setup();await assert.rejects(s.login.begin({browserBinding:'short'}),TitanOidcLoginError);});
test('rejects callback with missing state',async()=>{const s=setup();await assert.rejects(s.login.complete({state:'',code:'abc',browserBinding:binding}),TitanOidcLoginError);});
test('rejects non-https issuer',()=>{assert.throws(()=>setup({issuer:'http://evil.example'}),/invalid OIDC URL/);});
test('rejects insecure callback',()=>{assert.throws(()=>setup({redirectUri:'http://evil.example/auth/callback'}),/invalid OIDC URL/);});

test('localhost OIDC endpoints are refused without the dev flag and accepted with it',()=>{
 const local={issuer:'http://localhost:9000',redirectUri:'http://localhost:9000/auth/callback'};
 assert.throws(()=>setup(local),/invalid OIDC URL/);
 assert.equal(typeof setup({...local,allowInsecureLocalhost:true}).login.begin,'function');
});
