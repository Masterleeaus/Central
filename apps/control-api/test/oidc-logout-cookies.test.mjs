// Issue #31: every logout cookie is built and checked by oidc-cookie-policy.mjs. No sockets, no network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {logoutStateCookiePolicy,buildPolicyCookie,buildClearCookie,isPolicySetCookie,readCookie} from '../src/oidc-cookie-policy.mjs';
import {createGlobalLogout,createGlobalLogoutHandler,createLogoutLandingHandler,GLOBAL_LOGOUT_PATH} from '../src/oidc-global-logout.mjs';

const policy=logoutStateCookiePolicy();
const STATE='s'.repeat(43);
const good=`titan_global_logout_state=${STATE}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`;
const REGISTERED='https://central.titan.example/logged-out';
const ISSUER='https://auth.titan.example/oidc';
const fakeRes=()=>({status:0,headers:{},body:'',writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=b??'';}});
const cookiesOf=res=>[].concat(res.headers['set-cookie']??[]);

test('the state cookie policy builds the exact expected Set-Cookie and accepts it',()=>{
  assert.equal(buildPolicyCookie(policy,STATE,300),good);
  assert.equal(isPolicySetCookie(policy,good),true);
});
test('the state cookie policy refuses every weakened or foreign attribute set',()=>{
  const bad=[
    ['Domain attribute',`${good}; Domain=titanzero.io`],
    ['SameSite=None',good.replace('SameSite=Lax','SameSite=None')],
    ['duplicate Path',`${good}; Path=/`],
    ['duplicate Max-Age',`${good}; Max-Age=60`],
    ['unknown attribute',`${good}; Priority=High`],
    ['Expires attribute',`${good}; Expires=Wed, 21 Oct 2037 07:28:00 GMT`],
    ['Partitioned attribute',`${good}; Partitioned`],
    ['CRLF injection',`${good}\r\nSet-Cookie: evil=1`],
    ['LF injection',`${good}\nSet-Cookie: evil=1`],
    ['NUL byte',`${good}\x00`],
    ['missing Secure',good.replace('Secure; ','')],
    ['missing HttpOnly',good.replace('HttpOnly; ','')],
    ['missing SameSite',good.replace('SameSite=Lax; ','')],
    ['missing Max-Age',good.replace('; Max-Age=300','')],
    ['Max-Age over 300',good.replace('Max-Age=300','Max-Age=301')],
    ['Max-Age zero for a set (not a clear)',good.replace('Max-Age=300','Max-Age=0').replace(STATE,STATE)],
    ['Max-Age with sign',good.replace('Max-Age=300','Max-Age=+300')],
    ['short value',good.replace(STATE,'s'.repeat(8))],
    ['value with a slash',good.replace(STATE,'s'.repeat(42)+'/')],
    ['wrong cookie name: app session',good.replace('titan_global_logout_state','desk_sid')],
    ['wrong cookie name: session cookie of old logout',good.replace('titan_global_logout_state','titan_session')],
    ['wrong cookie name: app binding',good.replace('titan_global_logout_state','titan_desk_oidc_binding')],
    ['path other than /',good.replace('Path=/','Path=/auth')],
    ['no pair at all','Secure; HttpOnly; SameSite=Lax; Max-Age=300'],
  ];
  for(const [label,value] of bad) assert.equal(isPolicySetCookie(policy,value),false,label);
});
test('the policy never throws on non-string input',()=>{
  for(const v of [undefined,null,42,{},['x']]) assert.equal(isPolicySetCookie(policy,v),false);
});
test('the builder refuses values and lifetimes outside the policy',()=>{
  assert.throws(()=>buildPolicyCookie(policy,'short',300),TypeError);
  assert.throws(()=>buildPolicyCookie(policy,'s'.repeat(43)+'\r\nSet-Cookie: x=1',300),TypeError);
  assert.throws(()=>buildPolicyCookie(policy,STATE,301),TypeError);
  assert.throws(()=>buildPolicyCookie(policy,STATE,0),TypeError);
  assert.throws(()=>buildPolicyCookie(policy,STATE,1.5),TypeError);
});
test('the clear cookie for the state name is exact and passes the policy as a clear',()=>{
  const clear=buildClearCookie(policy);
  assert.equal(clear,'titan_global_logout_state=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
  assert.equal(isPolicySetCookie(policy,clear),true);
  assert.equal(isPolicySetCookie(policy,clear.replace('Max-Age=0','Max-Age=60')),false);
});
test('readCookie returns only an unambiguous single cookie value',()=>{
  assert.equal(readCookie(`a=1; titan_global_logout_state=${STATE}`,'titan_global_logout_state'),STATE);
  assert.equal(readCookie(`titan_global_logout_state=${STATE}; titan_global_logout_state=evil`,'titan_global_logout_state'),null);
  assert.equal(readCookie(`titan_global_logout_state_x=${STATE}`,'titan_global_logout_state'),null);
  assert.equal(readCookie(undefined,'titan_global_logout_state'),null);
  assert.equal(readCookie('x'.repeat(9000),'a'),null);
});

// Global logout response cookies
const ORIGIN='https://desk.titan.example';
const globalFor=(state)=>{
  const globalLogout=createGlobalLogout({issuer:ISSUER,postLogoutRedirectUris:[REGISTERED],revocations:{async revokeAll(){return 1}},randomState:()=>state});
  return createGlobalLogoutHandler({globalLogout,authenticateSession:async()=>({idTokenHint:'a.b.c',scopes:[{logtoSubject:'sub1',organisationId:'org1'}]}),postLogoutRedirectUri:REGISTERED,allowedOrigins:[ORIGIN]});
};
test('the global logout state cookie is produced by the policy and passes it',async()=>{
  const handler=globalFor(STATE);const res=fakeRes();
  await handler({method:'POST',url:GLOBAL_LOGOUT_PATH,headers:{origin:ORIGIN,'sec-fetch-site':'same-origin'}},res);
  assert.equal(res.status,303);
  for(const c of cookiesOf(res)) assert.equal(isPolicySetCookie(policy,c),true,c);
});
test('a state generator that does not fit the policy is refused at construction, before any redirect',()=>{
  assert.throws(()=>globalFor('short'),TypeError);
});
test('logout module builds no Set-Cookie string by hand (source guard)',()=>{
  const src=readFileSync(fileURLToPath(new URL('../src/oidc-global-logout.mjs',import.meta.url)),'utf8');
  assert.equal(/Path=\/; Secure/.test(src),false);
  assert.equal(/Max-Age=\$\{/.test(src),false);
  assert.equal(/set-cookie'\s*:\s*`/.test(src),false);
});

// Landing handler (state cookie consumption)
const landing=createLogoutLandingHandler({postLogoutRedirectUri:REGISTERED});
const landReq=({url=`/logged-out?state=${STATE}`,method='GET',cookie=`titan_global_logout_state=${STATE}`}={})=>({method,url,headers:cookie===null?{}:{cookie}});
test('valid state and matching cookie give a local-only redirect and clear the cookie',async()=>{
  const res=fakeRes();assert.equal(await landing(landReq(),res),true);
  assert.equal(res.status,303);assert.equal(res.headers.location,'/');
  assert.equal(isPolicySetCookie(policy,cookiesOf(res)[0]),true);
  assert.match(cookiesOf(res)[0],/Max-Age=0$/);
});
test('the landing redirect is always the configured local path, never a request value',async()=>{
  const l=createLogoutLandingHandler({postLogoutRedirectUri:REGISTERED,signedOutPath:'/signed-out'});
  const res=fakeRes();await l(landReq({url:`/logged-out?state=${STATE}`}),res);
  assert.equal(res.headers.location,'/signed-out');
});
test('a mismatched, missing or repeated state is refused and the cookie is cleared',async()=>{
  const cases=[
    ['mismatched state',`/logged-out?state=${'t'.repeat(43)}`,`titan_global_logout_state=${STATE}`],
    ['missing state parameter','/logged-out',`titan_global_logout_state=${STATE}`],
    ['missing cookie',`/logged-out?state=${STATE}`,null],
    ['no state cookie but other cookies',`/logged-out?state=${STATE}`,'other=1'],
    ['duplicate state cookie',`/logged-out?state=${STATE}`,`titan_global_logout_state=${STATE}; titan_global_logout_state=${'t'.repeat(43)}`],
    ['duplicate state parameter',`/logged-out?state=${STATE}&state=${STATE}`,`titan_global_logout_state=${STATE}`],
    ['extra parameter',`/logged-out?state=${STATE}&post_logout_redirect_uri=https://evil.example`,`titan_global_logout_state=${STATE}`],
    ['short state',`/logged-out?state=short`,`titan_global_logout_state=short`],
  ];
  for(const [label,url,cookie] of cases){
    const res=fakeRes();assert.equal(await landing(landReq({url,cookie}),res),true,label);
    assert.equal(res.status,400,label);assert.equal(res.headers.location,undefined,label);
    assert.match(cookiesOf(res)[0],/^titan_global_logout_state=; .*Max-Age=0$/,label);
  }
});
test('the landing answers only GET and ignores other paths',async()=>{
  const res=fakeRes();await landing(landReq({method:'POST'}),res);assert.equal(res.status,405);
  const other=fakeRes();assert.equal(await landing(landReq({url:'/elsewhere?state='+STATE}),other),false);assert.equal(other.status,0);
});
test('the landing refuses a non-local or unsafe signed-out path at construction',()=>{
  for(const p of ['https://evil.example/','//evil.example','/\\evil.example','/a\r\nSet-Cookie: x=1','relative','/ok\x00'])
    assert.throws(()=>createLogoutLandingHandler({postLogoutRedirectUri:REGISTERED,signedOutPath:p}),TypeError,p);
});
test('the landing refuses a non-https registered URI at construction',()=>{
  assert.throws(()=>createLogoutLandingHandler({postLogoutRedirectUri:'http://central.titan.example/logged-out'}),TypeError);
});
