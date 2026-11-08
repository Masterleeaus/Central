import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTitanOidcRegistrationPlans} from '../../../packages/control-plane/dist/oidc-registration.js';
import {getApplication,makeOidcRedirect,oidcCallbackPath} from '../../../packages/control-plane/dist/applications.js';
import {createOidcHttpAdapter} from '../src/oidc-http-adapter.mjs';
import {createOidcLogin} from '../src/oidc-login.mjs';

// Contract (issue #33): redirect URI = https://{app origin}/auth/titan/{applicationId}/callback.
const origins={desk:'https://desk.titanzero.io',field:'https://field.titanzero.io',academy:'https://academy.titanzero.io'};
const plans=createTitanOidcRegistrationPlans(origins);
const binding='b'.repeat(43);
const goodSession='desk_sid='+'s'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600';
const callbackCookie=(app)=>`titan_${app}_oidc_binding=${binding}`;
const res=()=>({status:null,headers:null,writeHead(s,h){this.status=s;this.headers=h},end(){}});
function adapterFor(app){
  const counts={complete:0};
  const adapter=createOidcHttpAdapter({applicationId:app,afterLogin:'/home',
    oidcLogin:{async begin(){return {authorizationUrl:'https://id.example/oidc/auth?state=s'}},async complete(){counts.complete++;return {subject:'uid',issuer:'https://id.example'}}},
    resolveLocalIdentity:async()=>({authorised:true,localUserId:'u',localAccountId:'a',organisationId:'o'}),
    establishSession:async({applicationId})=>goodSession.replace('desk_sid',`${applicationId}_sid`)});
  return {adapter,counts};
}
const hit=async(adapter,app,target)=>{const r=res();const handled=await adapter({url:target,method:'GET',headers:{cookie:callbackCookie(app)}},r);return {handled,r};};

test('registration plans use the single /auth/titan/{app}/callback contract',()=>{
  for(const p of plans){
    assert.deepEqual(p.redirectUris,[`${p.origin}/auth/titan/${p.app}/callback`]);
    assert.equal(getApplication(p.app).callbackPath,oidcCallbackPath(p.app));
    assert.equal(makeOidcRedirect(p.origin,p.app),p.redirectUris[0]);
  }
});
for(const plan of plans){
  test(`${plan.app}: exact registered callback URI is recognised by that app's adapter`,async()=>{
    const uri=plan.redirectUris[0];
    const {adapter,counts}=adapterFor(plan.app);
    const {handled,r}=await hit(adapter,plan.app,`${new URL(uri).pathname}?state=s&code=c`);
    assert.equal(handled,true);
    assert.equal(r.status,303,'callback branch handled the request');
    assert.equal(counts.complete,1);
  });
  test(`${plan.app}: login configuration sends the exact registered redirect_uri`,async()=>{
    const uri=plan.redirectUris[0];
    const login=createOidcLogin({issuer:'https://id.example',clientId:'client',clientSecret:'secret',redirectUri:uri,
      loginStore:{save:async()=>{},consume:async()=>null},verifyIdToken:async()=>({})});
    const {authorizationUrl}=await login.begin({browserBinding:binding});
    assert.equal(new URL(authorizationUrl).searchParams.get('redirect_uri'),uri);
  });
  test(`${plan.app}: near-match paths are not routes`,async()=>{
    const path=new URL(plan.redirectUris[0]).pathname;
    const app=plan.app;
    const cap=app[0].toUpperCase()+app.slice(1);
    const nearMatches=[
      `${path}/`,                       // trailing slash
      `${path}/extra`,                  // extra segment
      `${path}x`,                       // suffix on last segment
      path.toUpperCase(),               // different case throughout
      path.replace(app,cap),            // different case in the app id
      path.replace('/callback','%2Fcallback'), // encoded slash before the last segment
      path.replace('/callback','/callback%2F'), // encoded trailing slash
      path.replace('/callback','/call%62ack'), // percent-encoded letter
      path.replace('/callback','/./callback'), // dot segment, not normalised
      `//${path.slice(1)}`,             // extra leading slash (authority form)
      path.replace('/callback','/callback;x'), // path parameter
    ];
    const {adapter,counts}=adapterFor(app);
    for(const target of nearMatches){
      const {handled}=await hit(adapter,app,`${target}?state=s&code=c`);
      assert.equal(handled,false,`near-match must not be routed: ${target}`);
    }
    assert.equal(counts.complete,0);
  });
}
test('a registered URI is recognised only by its own application',async()=>{
  for(const plan of plans) for(const other of plans.filter(p=>p.app!==plan.app)){
    const {adapter,counts}=adapterFor(other.app);
    const {handled}=await hit(adapter,other.app,`${new URL(plan.redirectUris[0]).pathname}?state=s&code=c`);
    assert.equal(handled,false,`${plan.app} path accepted by ${other.app}`);
    assert.equal(counts.complete,0);
  }
});
