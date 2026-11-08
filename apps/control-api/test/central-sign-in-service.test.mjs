import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralSignInService} from '../src/central-sign-in-service.mjs';
const ORG='00000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-11-09T00:00:00.000Z');
const response=()=>({status:0,headers:{},body:null,writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}});
function fixture(){
  const state=new Map(),trace=[];
  let storedNonce=null;
  const stateStore={
    async save(key,value){state.set(key,value);storedNonce=value.nonce;},
    async consume(key){const value=state.get(key);state.delete(key);return value??null;}
  };
  const service=createCentralSignInService({
    pool:{connect:async()=>{throw Error('not needed for injected store')}},
    sessions:{async issue(value){trace.push(['issue',value]);return {cookie:'__Host-titan-central='+'A'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800'}}},
    issuer:'https://issuer.example',clientId:'central-client',clientSecret:'unit-test-secret',
    redirectUri:'https://central.example/auth/central/callback',
    verifyIdToken:async()=>({sub:'subject-123',nonce:storedNonce,iss:'https://issuer.example',aud:'central-client',exp:Math.floor(NOW/1000)+120}),
    listEligibleCompanies:async identity=>{trace.push(['eligible',identity]);return [{companyId:ORG,authorised:true}]},
    recheckCompany:async identity=>{trace.push(['recheck',identity]);return true},
    fetcher:async()=>({ok:true,json:async()=>({id_token:'signed-token-placeholder',access_token:'access-token-placeholder',token_type:'Bearer'})}),
    stateStore,clock:()=>NOW
  });
  return {service,state,trace};
}
test('OIDC authorization code and bound callback issue Central session only after fresh membership recheck',async()=>{
  const {service,state,trace}=fixture();
  const start=response();
  await service.handler({method:'GET',url:'/auth/central/start',headers:{}},start);
  assert.equal(start.status,303);
  const loginUrl=new URL(start.headers.location);
  assert.equal(loginUrl.searchParams.get('redirect_uri'),'https://central.example/auth/central/callback');
  assert.equal(loginUrl.searchParams.get('code_challenge_method'),'S256');
  assert.equal(state.size,1);
  const binding=start.headers['set-cookie'].split(';')[0];
  const finish=response();
  await service.handler({method:'GET',url:'/auth/central/callback?state='+loginUrl.searchParams.get('state')+'&code=authorization-code',headers:{cookie:binding}},finish);
  assert.equal(finish.status,303);
  assert.equal(finish.headers.location,'/central');
  assert.equal(state.size,0);
  assert.deepEqual(trace.map(x=>x[0]),['eligible','recheck','issue']);
  assert.deepEqual(trace.at(-1)[1],{identityId:'subject-123',companyId:ORG});
});
test('callback state cannot be replayed to issue a second Central session',async()=>{
  const {service,trace}=fixture();
  const start=response();await service.handler({method:'GET',url:'/auth/central/start',headers:{}},start);
  const binding=start.headers['set-cookie'].split(';')[0];
  const state=new URL(start.headers.location).searchParams.get('state');
  const req={method:'GET',url:'/auth/central/callback?state='+state+'&code=authorization-code',headers:{cookie:binding}};
  const first=response();await service.handler(req,first);
  assert.equal(first.status,303);
  const second=response();await service.handler(req,second);
  assert.equal(second.status,401);
  assert.equal(trace.filter(x=>x[0]==='issue').length,1);
});
test('misregistered callback paths are rejected before OIDC construction',()=>{
  const {service}=fixture();
  assert.ok(service);
  for(const bad of ['https://central.example/auth/callback','https://central.example/auth/central/callback?next=other','http://central.example/auth/central/callback']){
    assert.throws(()=>createCentralSignInService({
      pool:{connect:async()=>{}},sessions:{issue:async()=>{}},
      issuer:'https://issuer.example',clientId:'id',clientSecret:'secret',
      redirectUri:bad,verifyIdToken:async()=>{},listEligibleCompanies:async()=>[],recheckCompany:async()=>false,stateStore:{save:async()=>{},consume:async()=>{}}
    }),TypeError);
  }
});

test('default company authority performs restricted discovery and current RLS membership check',async()=>{
  const state=new Map(),trace=[];let nonce;
  const pool={async connect(){return {
    async query(sql,args){
      trace.push([sql,args]);
      if(sql.includes('central_eligible_companies'))return {rows:[{organisation_id:ORG,logto_organisation_id:'org-logto'}]};
      if(sql.includes('FROM titan.identities'))return {rows:[{id:'identity-1',logto_subject:'subject-123',state:'active'}]};
      if(sql.includes('FROM titan.organisations'))return {rows:[{id:ORG,logto_organisation_id:'org-logto',state:'active'}]};
      if(sql.includes('FROM titan.memberships'))return {rows:[{id:'m1',identity_id:'identity-1',organisation_id:ORG,role:'owner',state:'active',expires_at:null,revision:1}]};
      if(sql.includes('FROM titan.entitlements'))return {rows:[{id:'e1',organisation_id:ORG,application_id:args[1],state:'active',features:[],expires_at:null,revision:1}]};
      return {rows:[]};
    },release(){}
  }}};
  const calls=[];
  const service=createCentralSignInService({
    pool,sessions:{async issue(value){calls.push(value);return {cookie:'__Host-titan-central='+'A'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800'}}},
    issuer:'https://issuer.example',clientId:'central-client',clientSecret:'secret',
    redirectUri:'https://central.example/auth/central/callback',
    verifyIdToken:async()=>({sub:'subject-123',nonce,iss:'https://issuer.example',aud:'central-client',exp:Math.floor(NOW/1000)+120}),
    stateStore:{async save(key,value){state.set(key,value);nonce=value.nonce},async consume(key){const record=state.get(key);state.delete(key);return record??null}},
    fetcher:async()=>({ok:true,json:async()=>({id_token:'id-token',access_token:'access-token',token_type:'Bearer'})}),
    getCompanyName:async()=> 'Verified Company',clock:()=>NOW
  });
  const begin=response();await service.handler({method:'GET',url:'/auth/central/start',headers:{}},begin);
  const cb=response();await service.handler({method:'GET',url:'/auth/central/callback?state='+new URL(begin.headers.location).searchParams.get('state')+'&code=code',headers:{cookie:begin.headers['set-cookie'].split(';')[0]}},cb);
  assert.equal(cb.status,303);
  assert.deepEqual(calls,[{identityId:'subject-123',companyId:ORG}]);
  const discovery=trace.find(([sql])=>sql.includes('central_eligible_companies'));
  assert.deepEqual(discovery[1],['subject-123']);
  assert.ok(trace.some(([sql])=>sql==='SET LOCAL ROLE titan_central_discovery'));
  assert.ok(trace.some(([sql])=>sql==='SET LOCAL ROLE titan_trusted_reader'));
  assert.ok(trace.some(([sql,args])=>sql.includes('set_config')&&args[0]===ORG));
});

test('partially injected company authority cannot silently bypass trusted RLS checks',()=>{
  assert.throws(()=>createCentralSignInService({
    pool:{connect:async()=>{}},sessions:{issue:async()=>{}},
    issuer:'https://issuer.example',clientId:'id',clientSecret:'secret',
    redirectUri:'https://central.example/auth/central/callback',
    verifyIdToken:async()=>{},listEligibleCompanies:async()=>[{companyId:ORG,authorised:true}],
    stateStore:{save:async()=>{},consume:async()=>{}}
  }),/trusted Central sign-in dependencies required/);
});
