import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralBrowserRouter} from '../src/central-browser-router.mjs';

const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const env={
  TITAN_CENTRAL_BROWSER_ENABLED:'1',
  TITAN_CENTRAL_BROWSER_ORIGIN:'https://central.example/',
  TITAN_CENTRAL_BROWSER_REDIRECT_URI:'https://central.example/auth/central/callback',
  TITAN_CENTRAL_BROWSER_CLIENT_ID:'central-client',
  TITAN_CENTRAL_BROWSER_CLIENT_SECRET:'test-secret',
  TITAN_OIDC_ISSUER:'https://issuer.example',
  TITAN_OIDC_JWKS_URI:'https://issuer.example/jwks',
  TITAN_OIDC_STATE_KEY:Buffer.alloc(32,1).toString('base64'),
  TITAN_CENTRAL_SORTED_ORIGIN:'https://sorted.example/',
  TITAN_CENTRAL_SUPERCHARGED_ORIGIN:'https://supercharged.example/',
  TITAN_CENTRAL_LMS_ORIGIN:'https://lms.example/'
};
const res=()=>({status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers},end(body=''){this.body=body}});
const req=(url,method='GET',headers={})=>({url,method,headers});
function setup(){
  const sessions=new Map(),loginState=new Map(),selectionState=new Map(),calls=[];
  let nonce;
  const store={
    async insert(record){sessions.set(record.digest,record)},
    async find(key){return sessions.get(key)??null},
    async delete(key){return sessions.delete(key)}
  };
  const db={async connect(){return {
    async query(sql,args){
      calls.push([sql,args]);
      if(sql.includes('central_eligible_companies'))return {rows:[{organisation_id:A,logto_organisation_id:'logto-a'}]};
      if(sql.includes('FROM titan.identities'))return {rows:[{id:'identity-1',logto_subject:'subject-1',state:'active'}]};
      if(sql.includes('FROM titan.organisations'))return {rows:[{id:A,logto_organisation_id:'logto-a',state:'active'}]};
      if(sql.includes('FROM titan.memberships'))return {rows:[{id:'membership-1',identity_id:'identity-1',organisation_id:A,role:'owner',state:'active',expires_at:null,revision:1}]};
      if(sql.includes('FROM titan.entitlements'))return {rows:[{id:'entitlement-1',organisation_id:A,application_id:args[1],state:'active',features:[],expires_at:null,revision:1}]};
      if(sql.includes('FROM titan.local_account_links'))return {rows:[{id:'link-1',identity_id:'identity-1',organisation_id:A,application_id:args[2],local_user_id:'user',local_account_id:'account',state:'verified',verified_at:new Date(),revision:1}]};
      return {rows:[]};
    },release(){}
  }}};
  const router=createCentralBrowserRouter({
    env,pool:db,getCompanyName:async()=> 'Verified & Co',launcherStore:store,
    stateStore:{async save(key,value){loginState.set(key,value);nonce=value.nonce},async consume(key){const found=loginState.get(key);loginState.delete(key);return found??null}},
    selectionStore:{async save(key,value){selectionState.set(key,value)},async consume(key){const found=selectionState.get(key);selectionState.delete(key);return found??null}},
    verifyIdToken:async()=>({iss:env.TITAN_OIDC_ISSUER,aud:env.TITAN_CENTRAL_BROWSER_CLIENT_ID,sub:'subject-1',nonce,exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000)}),
    fetcher:async()=>({ok:true,json:async()=>({id_token:'signed-token-mocked',access_token:'access-token',token_type:'Bearer'})})
  });
  return {router,calls,sessions};
}
test('browser feature defaults disabled; invalid flag fails at startup',()=>{
  assert.equal(createCentralBrowserRouter({env:{}}),null);
  assert.equal(createCentralBrowserRouter({env:{TITAN_CENTRAL_BROWSER_ENABLED:'0'}}),null);
  assert.throws(()=>createCentralBrowserRouter({env:{TITAN_CENTRAL_BROWSER_ENABLED:'yes'}}),TypeError);
});
test('enabled mode requires trusted company lookup and exact HTTPS callback',()=>{
  assert.throws(()=>createCentralBrowserRouter({env,pool:{connect:async()=>{}}}),/company name authority/);
  assert.throws(()=>createCentralBrowserRouter({env:{...env,TITAN_CENTRAL_BROWSER_REDIRECT_URI:'https://attacker.example/auth/central/callback'},pool:{connect:async()=>{}},getCompanyName:async()=> 'a'}),/callback mismatch/);
  assert.throws(()=>createCentralBrowserRouter({env:{...env,TITAN_CENTRAL_BROWSER_ORIGIN:'http://central.example/'},pool:{connect:async()=>{}},getCompanyName:async()=> 'a'}),/HTTPS origin/);
});
test('enabled browser router connects OIDC callback, RLS launcher, and durable logout',async()=>{
  const f=setup();
  const anonymous=res();
  assert.equal(await f.router.handler(req('/central'),anonymous),true);
  assert.equal(anonymous.status,401);
  const begin=res();await f.router.handler(req('/auth/central/start'),begin);
  assert.equal(begin.status,303);
  const params=new URL(begin.headers.location).searchParams;
  assert.equal(params.get('redirect_uri'),env.TITAN_CENTRAL_BROWSER_REDIRECT_URI);
  const correlation=begin.headers['set-cookie'].split(';')[0];
  const complete=res();await f.router.handler(req('/auth/central/callback?state='+params.get('state')+'&code=code','GET',{cookie:correlation}),complete);
  assert.equal(complete.status,303);
  const token=complete.headers['set-cookie'][1].split(';')[0];
  const page=res();await f.router.handler(req('/central','GET',{cookie:token}),page);
  assert.equal(page.status,200);
  assert.match(page.body,/Verified &amp; Co/);
  assert.match(page.body,/Sign out of Central/);
  assert.ok(f.calls.some(([sql])=>sql.includes('central_eligible_companies')));
  const logout=res();
  await f.router.handler(req('/auth/central/logout','POST',{origin:'https://central.example',cookie:token,'content-length':'0','sec-fetch-site':'same-origin'}),logout);
  assert.equal(logout.status,303);
  const after=res();await f.router.handler(req('/central','GET',{cookie:token}),after);
  assert.equal(after.status,401);
});
test('unrecognised paths are delegated without response',async()=>{
  const f=setup(),r=res();
  assert.equal(await f.router.handler(req('/v1/access/check'),r),false);
  assert.equal(r.status,0);
});
