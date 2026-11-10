// Issue #6 (a)(c)(d): ID token stored at callback, logout with id_token_hint across desk, field and academy,
// and the state-cookie landing. Fakes only: no sockets, no Logto, no database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOidcHttpAdapter} from '../src/oidc-http-adapter.mjs';
import {createOidcLogin} from '../src/oidc-login.mjs';
import {createIdTokenVault,createLogoutSessionAuthenticator} from '../src/oidc-id-token-store.mjs';
import {createGlobalLogout,createGlobalLogoutHandler,createLogoutLandingHandler,GLOBAL_LOGOUT_PATH} from '../src/oidc-global-logout.mjs';

const KEY=Buffer.alloc(32,5).toString('base64');
const ENV={TITAN_OIDC_STATE_KEY:KEY};
const ISSUER='https://auth.titan.example/oidc';
const SUB='logto_user_1';
const ID_TOKEN='eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJsb2d0b191c2VyXzEifQ.sig-part';
const BINDING='b'.repeat(43);
const cb=`titan_desk_oidc_binding=${BINDING}`;
const makeRes=()=>({status:null,headers:null,body:'',writeHead(s,h){this.status=s;this.headers=h},end(s=''){this.body=s}});
const cookiesOf=res=>[].concat(res.headers?.['set-cookie']??[]);
const sessionCookie=app=>`${app}_sid=${app}-session-token-${'z'.repeat(20)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`;

// Fake app session store: one per app, keyed by the server-side session id. Revocation is shared across apps.
function appStore(app){
  const sessions=new Map();const byToken=new Map();
  return {
    sessions,
    async establish({sessionId,localUserId,localAccountId,organisationId,oidcSubject}){
      const token=`${app}-session-token-${sessionId}`.padEnd(40,'x');
      sessions.set(sessionId,{sessionId,logtoSubject:oidcSubject,scopes:[{logtoSubject:oidcSubject,organisationId}],organisationId,localUserId,localAccountId,sealedIdToken:undefined});
      byToken.set(token,sessionId);
      return {cookie:`${app}_sid=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`,sessionId};
    },
    async storeIdToken({sessionId,subject,sealed}){
      const s=sessions.get(sessionId);
      if(!s||s.logtoSubject!==subject)throw Error('session missing');
      s.sealedIdToken=sealed;
    },
    loadSession(req){
      const cookie=req.headers?.cookie??'';const m=cookie.match(new RegExp(`${app}_sid=([^;]+)`));
      const sid=m&&byToken.get(m[1]);return sid?sessions.get(sid)??null:null;
    },
    tokenFor(sessionId){for(const [t,id] of byToken)if(id===sessionId)return t;return null;}
  };
}

test('oidc-login returns the verified raw ID token for the adapter to seal',async()=>{
  const binding='b'.repeat(42);let nonce;const pending=new Map();
  const loginStore={save:async(k,v)=>{pending.set(k,v)},consume:async k=>{const v=pending.get(k);pending.delete(k);return v}};
  const meta={issuer:ISSUER,authorization_endpoint:`${ISSUER}/oidc/auth`,token_endpoint:`${ISSUER}/oidc/token`};
  const fetcher=async(u)=>String(u).endsWith('/.well-known/openid-configuration')?{ok:true,redirected:false,json:async()=>meta,text:async()=>JSON.stringify(meta)}:{ok:true,json:async()=>({id_token:ID_TOKEN,access_token:'a'.repeat(20),token_type:'Bearer'})};
  const login=createOidcLogin({issuer:ISSUER,clientId:'desk-client',clientSecret:'secret',redirectUri:'https://desk.titan.example/auth/titan/desk/callback',loginStore,fetcher,clock:()=>1_800_000_000_000,
    verifyIdToken:async()=>({iss:ISSUER,aud:'desk-client',sub:SUB,nonce,exp:1_800_000_060})});
  const u=new URL((await login.begin({browserBinding:binding})).authorizationUrl);nonce=u.searchParams.get('nonce');
  const out=await login.complete({state:u.searchParams.get('state'),code:'c',browserBinding:binding});
  assert.equal(out.idToken,ID_TOKEN);assert.equal(out.subject,SUB);
});

function desk({complete,store,logs=[],establishOverride,vault=createIdTokenVault({applicationId:'desk',env:ENV}),storeIdToken,...rest}={}){
  const app=appStore('desk');
  const adapter=createOidcHttpAdapter({applicationId:'desk',afterLogin:'/workspace',
    logger:(event,fields)=>logs.push({event,fields}),
    oidcLogin:{begin:async()=>({authorizationUrl:'https://auth.titan.example/oidc/auth?state=s'}),complete:complete??(async()=>({subject:SUB,issuer:ISSUER,idToken:ID_TOKEN}))},
    resolveLocalIdentity:async()=>({authorised:true,localUserId:'user-1',localAccountId:'acct-1',organisationId:'org-1'}),
    establishSession:establishOverride??(async args=>app.establish({...args,sessionId:'sid_'+Math.random().toString(36).slice(2,12)})),
    idTokenVault:vault,storeIdToken:vault?(storeIdToken??(async args=>app.storeIdToken(args))):null,...rest});
  return {adapter,app,logs};
}
const call=async(adapter,url,headers={})=>{const res=makeRes();const handled=await adapter({url,method:'GET',headers},res);return {handled,res};};

test('successful callback seals the ID token with the session id and subject, and stores only the sealed value',async()=>{
  const {adapter,app,logs}=desk();
  const {res}=await call(adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
  assert.equal(res.status,303);assert.equal(cookiesOf(res).length,2);
  const [session]=[...app.sessions.values()];
  assert.ok(session.sealedIdToken,'sealed token stored');
  assert.ok(session.sealedIdToken.startsWith('v1.'));
  assert.equal(session.sealedIdToken.includes(ID_TOKEN),false);
  const vault=createIdTokenVault({applicationId:'desk',env:ENV});
  assert.equal(vault.open({sealed:session.sealedIdToken,sessionId:session.sessionId,subject:SUB}),ID_TOKEN);
  assert.throws(()=>vault.open({sealed:session.sealedIdToken,sessionId:'sid_other-value',subject:SUB}),/rejected/);
  assert.equal(JSON.stringify(logs).includes(ID_TOKEN),false);
});
test('storeIdToken receives application, session id, subject and sealed value, not the raw token',async()=>{
  const seen=[];const {adapter}=desk({storeIdToken:async a=>{seen.push(a)}});
  await call(adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
  assert.equal(seen.length,1);
  assert.deepEqual(Object.keys(seen[0]).sort(),['applicationId','sealed','sessionId','subject']);
  assert.equal(seen[0].applicationId,'desk');assert.equal(seen[0].subject,SUB);
  assert.equal(JSON.stringify(seen[0]).includes(ID_TOKEN),false);
});
test('establishSession returning only a cookie (no session id) fails closed when storage is enabled',async()=>{
  let stored=0;const {adapter}=desk({establishOverride:async()=>sessionCookie('desk'),storeIdToken:async()=>{stored++}});
  const {res}=await call(adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
  assert.equal(res.status,401);assert.equal(stored,0);assert.ok(!cookiesOf(res).some(c=>c.startsWith('desk_sid=')));
});
test('a callback without an ID token fails closed before any session is created',async()=>{
  let established=0;const {adapter}=desk({complete:async()=>({subject:SUB,issuer:ISSUER}),establishOverride:async()=>{established++;return {cookie:sessionCookie('desk'),sessionId:'sid_1234567'}}});
  const {res}=await call(adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
  assert.equal(res.status,401);assert.equal(established,0);
});
test('a failed ID-token store refuses the login and sends no session cookie',async()=>{
  const {adapter}=desk({storeIdToken:async()=>{throw Error('store down')}});
  const {res}=await call(adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
  assert.equal(res.status,401);assert.ok(!cookiesOf(res).some(c=>c.startsWith('desk_sid=')));
});
test('storage must be configured as a pair: vault without store, or store without vault, is refused',()=>{
  const base={applicationId:'desk',oidcLogin:{begin(){},complete(){}},resolveLocalIdentity(){},establishSession(){}};
  assert.throws(()=>createOidcHttpAdapter({...base,idTokenVault:createIdTokenVault({applicationId:'desk',env:ENV})}),TypeError);
  assert.throws(()=>createOidcHttpAdapter({...base,storeIdToken:async()=>{}}),TypeError);
  assert.throws(()=>createOidcHttpAdapter({...base,idTokenVault:{seal(){}},storeIdToken:async()=>{}}),TypeError);
});
test('without a vault the adapter behaves as before (no storage call, string cookie accepted)',async()=>{
  let stored=0;const {adapter}=desk({vault:null,storeIdToken:null,establishOverride:async()=>sessionCookie('desk')});
  assert.equal((await call(adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb})).res.status,303);assert.equal(stored,0);
});

// Three applications, each on its own host, each with its own session store and its own logout route.
const APPS=['desk','field','academy'];
const origin=app=>`https://${app}.titan.example`;
const postLogoutUri=app=>`${origin(app)}/auth/titan/logged-out`;
function threeApps(){
  const revoked=[];
  const revocations={async revokeAll(args){revoked.push(args);return revoked.length}};
  const world={};
  for(const app of APPS){
    const store=appStore(app);
    const vault=createIdTokenVault({applicationId:app,env:ENV});
    const adapter=createOidcHttpAdapter({applicationId:app,afterLogin:'/',
      oidcLogin:{begin:async()=>({authorizationUrl:`${ISSUER}/oidc/auth`}),complete:async()=>({subject:SUB,issuer:ISSUER,idToken:ID_TOKEN})},
      resolveLocalIdentity:async()=>({authorised:true,localUserId:`user-${app}`,localAccountId:`acct-${app}`,organisationId:'org-1'}),
      establishSession:args=>store.establish({...args,sessionId:`sid_${app}_${Math.random().toString(36).slice(2,10)}`}),
      idTokenVault:vault,storeIdToken:args=>store.storeIdToken(args)});
    const globalLogout=createGlobalLogout({issuer:ISSUER,postLogoutRedirectUris:[postLogoutUri(app)],revocations,randomState:()=>{const s=Math.random().toString(36).slice(2).padEnd(43,'q');return s.slice(0,43)}});
    const logout=createGlobalLogoutHandler({globalLogout,postLogoutRedirectUri:postLogoutUri(app),allowedOrigins:[origin(app)],
      authenticateSession:createLogoutSessionAuthenticator({applicationId:app,vault,loadSession:req=>store.loadSession(req)})});
    const landing=createLogoutLandingHandler({postLogoutRedirectUri:postLogoutUri(app)});
    world[app]={adapter,store,logout,landing};
  }
  return {world,revoked};
}

test('sign in to each app, then global logout from one app revokes all three and sends id_token_hint to Logto',async()=>{
  const {world,revoked}=threeApps();
  const sessions={};
  for(const app of APPS){
    const {res}=await (async()=>{const r=makeRes();await world[app].adapter({url:`/auth/titan/${app}/callback?state=s&code=c`,method:'GET',headers:{cookie:`titan_${app}_oidc_binding=${BINDING}`}},r);return {res:r}})();
    assert.equal(res.status,303,app);
    sessions[app]=cookiesOf(res).find(c=>c.startsWith(`${app}_sid=`)).split(';')[0].split('=').slice(1).join('=');
  }
  const req={method:'POST',url:GLOBAL_LOGOUT_PATH,headers:{origin:origin('desk'),'sec-fetch-site':'same-origin',cookie:`desk_sid=${sessions.desk}`}};
  const out=makeRes();await world.desk.logout(req,out);
  assert.equal(out.status,303);
  const location=new URL(out.headers.location);
  assert.equal(location.origin,'https://auth.titan.example');
  assert.equal(location.searchParams.get('id_token_hint'),ID_TOKEN);
  assert.equal(location.searchParams.get('post_logout_redirect_uri'),postLogoutUri('desk'));
  assert.deepEqual(revoked.map(r=>r.applicationId).sort(),['academy','desk','field']);
  assert.ok(revoked.every(r=>r.logtoSubject===SUB&&r.organisationId==='org-1'));
  // The state cookie set by the desk host is read back only by the desk landing.
  const stateCookie=cookiesOf(out).find(c=>c.startsWith('titan_global_logout_state='));
  const state=location.searchParams.get('state');
  const landed=makeRes();
  await world.desk.landing({method:'GET',url:`/auth/titan/logged-out?state=${state}`,headers:{cookie:stateCookie.split(';')[0]}},landed);
  assert.equal(landed.status,303);assert.equal(landed.headers.location,'/');
  // Host-only in production: another app's host never receives this cookie, so its landing has nothing to match.
  const otherHost=makeRes();
  await world.field.landing({method:'GET',url:`/auth/titan/logged-out?state=${state}`,headers:{}},otherHost);
  assert.equal(otherHost.status,400);
});

test('logout from an app with no session revokes nothing and produces no Logto redirect',async()=>{
  const {world,revoked}=threeApps();
  const out=makeRes();
  await world.field.logout({method:'POST',url:GLOBAL_LOGOUT_PATH,headers:{origin:origin('field'),'sec-fetch-site':'same-origin'}},out);
  assert.equal(out.status,401);assert.equal(out.headers.location,undefined);assert.equal(revoked.length,0);
});

test('a session whose sealed token was tampered with cannot log out and revokes nothing',async()=>{
  const revoked=[];
  const globalLogout=createGlobalLogout({issuer:ISSUER,postLogoutRedirectUris:[postLogoutUri('desk')],revocations:{async revokeAll(a){revoked.push(a);return 1}}});
  const authenticateSession=createLogoutSessionAuthenticator({applicationId:'desk',vault:createIdTokenVault({applicationId:'desk',env:ENV}),
    loadSession:async()=>({sessionId:'sid_desk_tamper1',logtoSubject:SUB,scopes:[{logtoSubject:SUB,organisationId:'org-1'}],sealedIdToken:'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'})});
  const handler=createGlobalLogoutHandler({globalLogout,postLogoutRedirectUri:postLogoutUri('desk'),allowedOrigins:[origin('desk')],authenticateSession});
  const out=makeRes();
  await handler({method:'POST',url:GLOBAL_LOGOUT_PATH,headers:{origin:origin('desk'),'sec-fetch-site':'same-origin',cookie:'desk_sid=whatever-token-value-0000000000'}},out);
  assert.equal(out.status,401);assert.equal(out.headers.location,undefined);assert.equal(revoked.length,0);
});

test('the landing refuses a state that does not match the logout cookie',async()=>{
  const {world}=threeApps();
  const out=makeRes();
  await world.desk.landing({method:'GET',url:`/auth/titan/logged-out?state=${'x'.repeat(43)}`,headers:{cookie:`titan_global_logout_state=${'y'.repeat(43)}`}},out);
  assert.equal(out.status,400);assert.equal(out.headers.location,undefined);
});
