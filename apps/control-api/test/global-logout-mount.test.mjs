import test from 'node:test';
import assert from 'node:assert/strict';
import {createGlobalLogoutMount,readGlobalLogoutGate} from '../src/global-logout-mount.mjs';
import {GLOBAL_LOGOUT_PATH} from '../src/oidc-global-logout.mjs';

const POST_URI='https://central.titan.example/auth/titan/logged-out';
const env={
  TITAN_OIDC_ISSUER:'https://auth.titan.example/oidc',
  TITAN_FIELD_ORIGIN:'https://field.titan.example',
  TITAN_DESK_ORIGIN:'https://desk.titan.example',
  TITAN_ACADEMY_ORIGIN:'https://academy.titan.example',
};
const pool={connect:async()=>({query:async()=>({rows:[]}),release(){}})};
const authenticateSession=async()=>null;
const res=()=>{const r={status:0,headers:{},body:'',writeHead(s,h){r.status=s;Object.assign(r.headers,h);},end(b=''){r.body+=b;}};return r;};

test('gate is off when unset, empty or 0, and nothing is built',()=>{
  for(const value of [undefined,'','0']){
    assert.equal(readGlobalLogoutGate({TITAN_GLOBAL_LOGOUT_ENABLED:value}),false,String(value));
    assert.equal(createGlobalLogoutMount({env:{...env,TITAN_GLOBAL_LOGOUT_ENABLED:value},pool}),null);
  }
});

test('any other gate value is a configuration error',()=>{
  assert.throws(()=>readGlobalLogoutGate({TITAN_GLOBAL_LOGOUT_ENABLED:'true'}),/invalid global logout feature flag/);
  assert.throws(()=>createGlobalLogoutMount({env:{...env,TITAN_GLOBAL_LOGOUT_ENABLED:'yes'},pool,authenticateSession}),/invalid global logout feature flag/);
});

test('enabled gate without a session authenticator fails startup',()=>{
  assert.throws(()=>createGlobalLogoutMount({env:{...env,TITAN_GLOBAL_LOGOUT_ENABLED:'1',TITAN_GLOBAL_LOGOUT_POST_URI:POST_URI},pool}),/session authenticator required/);
});

test('enabled gate requires an exact registered https post-logout URI',()=>{
  const on={...env,TITAN_GLOBAL_LOGOUT_ENABLED:'1'};
  assert.throws(()=>createGlobalLogoutMount({env:on,pool,authenticateSession}),/registered post-logout URIs required/);
  assert.throws(()=>createGlobalLogoutMount({env:{...on,TITAN_GLOBAL_LOGOUT_POST_URI:'http://central.titan.example/auth/titan/logged-out'},pool,authenticateSession}),/registered post-logout URIs required/);
});

test('enabled gate with every origin mounts both routes, and the logout route still refuses GET',async()=>{
  const mount=createGlobalLogoutMount({env:{...env,TITAN_GLOBAL_LOGOUT_ENABLED:'1',TITAN_GLOBAL_LOGOUT_POST_URI:POST_URI},pool,authenticateSession});
  assert.equal(typeof mount.logoutHandler,'function');
  assert.equal(typeof mount.landingHandler,'function');
  const r=res();
  assert.equal(await mount.logoutHandler({url:GLOBAL_LOGOUT_PATH,method:'GET',headers:{}},r),true);
  assert.equal(r.status,405);
  const other=res();
  assert.equal(await mount.logoutHandler({url:'/v1/access/check',method:'GET',headers:{}},other),false);
});

test('enabled gate with a missing application origin fails startup',()=>{
  assert.throws(()=>createGlobalLogoutMount({env:{...env,TITAN_ACADEMY_ORIGIN:undefined,TITAN_GLOBAL_LOGOUT_ENABLED:'1',TITAN_GLOBAL_LOGOUT_POST_URI:POST_URI},pool,authenticateSession}),/origins/);
});
