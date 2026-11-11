import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGlobalLogout,createGlobalLogoutHandler,GLOBAL_LOGOUT_PATH} from '../src/oidc-global-logout.mjs';
import {createCentralHandler} from '../src/app.mjs';
// No sockets: requests and responses are plain objects, so these tests make no network calls.
const ISSUER='https://auth.titan.example/oidc';
const REGISTERED='https://central.titan.example/logged-out';
const ORIGIN='https://desk.titan.example';
const COOKIE='titan_session';
const SCOPE={logtoSubject:'sub1',organisationId:'org1'};
const recorder=(fail=false)=>{const calls=[];let n=0;return {calls,async revokeAll(args){calls.push(args);if(fail)throw Error('db down');return ++n}};};
const fakeRes=()=>({status:0,headers:{},body:'',writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=b??'';}});
const req=({method='POST',url=GLOBAL_LOGOUT_PATH,headers={origin:ORIGIN,'sec-fetch-site':'same-origin'}}={})=>({method,url,headers});
const session=(extra={})=>async()=>({idTokenHint:'eyJhbGciOi.payload.sig',scopes:[SCOPE],...extra});
function make({revocations=recorder(),authenticateSession=session(),logger=()=>{}}={}){
  const globalLogout=createGlobalLogout({issuer:ISSUER,postLogoutRedirectUris:[REGISTERED],revocations,randomState:()=>'s'.repeat(43)});
  const handler=createGlobalLogoutHandler({globalLogout,authenticateSession,postLogoutRedirectUri:REGISTERED,allowedOrigins:[ORIGIN],sessionCookieName:COOKIE,logger});
  return {handler,revocations};
}
const run=async(handler,request)=>{const res=fakeRes();const handled=await handler(request,res);return {handled,res};};
const cookiesOf=res=>[].concat(res.headers['set-cookie']??[]);

test('builds the Logto end_session URL with id_token_hint, registered redirect and state',async()=>{
  const {handler}=make();const {res}=await run(handler,req());
  assert.equal(res.status,303);
  const u=new URL(res.headers.location);
  assert.equal(u.origin,'https://auth.titan.example');
  assert.equal(u.pathname,'/oidc/session/end');
  assert.equal(u.searchParams.get('id_token_hint'),'eyJhbGciOi.payload.sig');
  assert.equal(u.searchParams.get('post_logout_redirect_uri'),REGISTERED);
  assert.equal(u.searchParams.get('state'),'s'.repeat(43));
});
test('the post-logout redirect is fixed by config, not taken from the request',async()=>{
  const {handler}=make();const {res}=await run(handler,req({url:GLOBAL_LOGOUT_PATH+'?post_logout_redirect_uri=https://evil.example/'}));
  assert.equal(new URL(res.headers.location).searchParams.get('post_logout_redirect_uri'),REGISTERED);
});
test('construction refuses an unregistered post-logout redirect',()=>{
  const globalLogout=createGlobalLogout({issuer:ISSUER,postLogoutRedirectUris:[REGISTERED],revocations:recorder()});
  assert.throws(()=>createGlobalLogoutHandler({globalLogout,authenticateSession:session(),postLogoutRedirectUri:'https://evil.example/',allowedOrigins:[ORIGIN],sessionCookieName:COOKIE}),/unregistered/);
});
test('construction refuses bad origins, cookie names and missing dependencies',()=>{
  const globalLogout=createGlobalLogout({issuer:ISSUER,postLogoutRedirectUris:[REGISTERED],revocations:recorder()});
  const base={globalLogout,authenticateSession:session(),postLogoutRedirectUri:REGISTERED,allowedOrigins:[ORIGIN],sessionCookieName:COOKIE};
  assert.throws(()=>createGlobalLogoutHandler({...base,allowedOrigins:[]}),/origins/);
  assert.throws(()=>createGlobalLogoutHandler({...base,allowedOrigins:['https://desk.titan.example/']}),/origins/);
  assert.throws(()=>createGlobalLogoutHandler({...base,authenticateSession:null}),/authenticator/);
});
test('GET never revokes and returns a safe 405, with or without a session',async()=>{
  const rev=recorder();const {handler}=make({revocations:rev});
  const none=await run(handler,req({method:'GET'}));
  assert.equal(none.res.status,405);assert.equal(none.res.headers.allow,'POST');assert.equal(cookiesOf(none.res).length,0);
  const withSession=await run(handler,req({method:'GET'}));
  assert.equal(withSession.res.status,405);
  assert.equal(rev.calls.length,0);
});
test('POST with no session returns 401 and revokes nothing',async()=>{
  const rev=recorder();const {handler}=make({revocations:rev,authenticateSession:async()=>null});
  const {res}=await run(handler,req());
  assert.equal(res.status,401);assert.equal(res.headers.location,undefined);assert.equal(rev.calls.length,0);
});
test('missing Origin is refused before any session lookup or revocation',async()=>{
  const rev=recorder();let looked=false;const {handler}=make({revocations:rev,authenticateSession:async()=>{looked=true;return {idTokenHint:'t.t.t',scopes:[SCOPE]}}});
  const {res}=await run(handler,req({headers:{'sec-fetch-site':'same-origin'}}));
  assert.equal(res.status,403);assert.equal(looked,false);assert.equal(rev.calls.length,0);
});
test('cross-site and foreign-origin POSTs are refused',async()=>{
  const rev=recorder();const {handler}=make({revocations:rev});
  assert.equal((await run(handler,req({headers:{origin:ORIGIN,'sec-fetch-site':'cross-site'}}))).res.status,403);
  assert.equal((await run(handler,req({headers:{origin:'https://evil.example','sec-fetch-site':'same-origin'}}))).res.status,403);
  assert.equal((await run(handler,req({headers:{origin:'null','sec-fetch-site':'same-origin'}}))).res.status,403);
  assert.equal((await run(handler,req({headers:{origin:ORIGIN}}))).res.status,403);
  assert.equal(rev.calls.length,0);
});
test('authorised POST revokes every app for the caller, clears the session cookie and redirects',async()=>{
  const rev=recorder();const {handler}=make({revocations:rev});
  const {res}=await run(handler,req());
  assert.equal(res.status,303);
  assert.equal(rev.calls.length,3);
  assert.deepEqual(rev.calls.map(c=>c.applicationId).sort(),['academy','desk','field']);
  assert.ok(rev.calls.every(c=>c.logtoSubject==='sub1'&&c.organisationId==='org1'));
  assert.equal(res.headers['cache-control'],'no-store');
});
test('Central sets only the policy state cookie and never clears app session cookies (host-only, owned by each app)',async()=>{
  const {handler}=make();const {res}=await run(handler,req());
  const cookies=cookiesOf(res);
  assert.equal(cookies.length,1);
  assert.ok(!cookies.some(c=>c.startsWith('titan_session=')));
  assert.equal(cookies[0],`titan_global_logout_state=${'s'.repeat(43)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`);
});
test('a failed revocation produces no redirect and clears no cookie',async()=>{
  const {handler}=make({revocations:recorder(true)});const {res}=await run(handler,req());
  assert.equal(res.status,503);assert.match(res.body,/logout_unavailable/);
  assert.equal(res.headers.location,undefined);assert.equal(cookiesOf(res).length,0);
});
test('a session with malformed id_token_hint fails closed with no revocation',async()=>{
  const rev=recorder();const {handler}=make({revocations:rev,authenticateSession:session({idTokenHint:'a b'})});
  const {res}=await run(handler,req());
  assert.equal(res.status,503);assert.equal(rev.calls.length,0);
});
test('paths other than the logout route are not handled',async()=>{
  const {handler}=make();const {handled,res}=await run(handler,req({url:'/v1/access/check'}));
  assert.equal(handled,false);assert.equal(res.status,0);
});
test('logger receives counts and error classes only',async()=>{
  const events=[];const {handler}=make({logger:(e,f)=>events.push([e,f])});
  await run(handler,req());
  assert.deepEqual(events,[['global_logout_started',{revoked:3}]]);
  const bad=make({logger:(e,f)=>events.push([e,f]),revocations:recorder(true)});
  await run(bad.handler,req());
  assert.equal(events[1][0],'global_logout_failed');
  assert.equal(JSON.stringify(events).includes('eyJ'),false);
});
test('central dispatch reaches the logout handler before the admin branch',async()=>{
  const rev=recorder();const {handler}=make({revocations:rev});
  const pool={async connect(){return {async query(){return {rows:[]}},release(){}}},async query(){return {rows:[]}}};
  const central=createCentralHandler({pool,verifyToken:async()=>{throw Error('unused')},issuer:ISSUER,audiences:{field:'a1',desk:'a2',academy:'a3'},globalLogoutHandler:handler,healthQuery:async()=>({rows:[]})});
  const res=fakeRes();await central(req(),res);
  assert.equal(res.status,303);assert.equal(rev.calls.length,3);
});
test('central without a logout handler still returns 404 for unknown paths',async()=>{
  const pool={async query(){return {rows:[]}}};
  const central=createCentralHandler({pool,verifyToken:async()=>{throw Error('unused')},issuer:ISSUER,audiences:{field:'a1',desk:'a2',academy:'a3'},healthQuery:async()=>({rows:[]})});
  const res=fakeRes();await central(req(),res);
  assert.equal(res.status,404);
});
