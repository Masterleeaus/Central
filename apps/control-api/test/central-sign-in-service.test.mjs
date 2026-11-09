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

test('multi-company OIDC callback hands off to one-use selection and issues session after POST',async()=>{
  const state=new Map(),choices=new Map(),trace=[];
  let nonce;
  const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
  const service=createCentralSignInService({
    pool:{async connect(){throw Error('injected stores do not touch database')}},
    sessions:{async issue(payload){trace.push(['issue',payload]);return {cookie:'__Host-titan-central='+'A'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800'}}},
    issuer:'https://issuer.example',clientId:'central-client',clientSecret:'unit-test-secret',
    redirectUri:'https://central.example/auth/central/callback',enableCompanySelection:true,
    verifyIdToken:async()=>({sub:'subject-123',nonce,iss:'https://issuer.example',aud:'central-client',exp:Math.floor(NOW/1000)+120}),
    listEligibleCompanies:async()=>[{companyId:A,authorised:true},{companyId:B,authorised:true}],
    listOrganisations:async()=>[{id:A,name:'Alpha & Co'},{id:B,name:'Beta Co'}],
    recheckCompany:async record=>{trace.push(['recheck',record]);return true},
    stateStore:{async save(key,value){state.set(key,value);nonce=value.nonce},async consume(key){const record=state.get(key);state.delete(key);return record??null}},
    selectionStore:{async save(key,value){choices.set(key,value)},async consume(key){const record=choices.get(key);choices.delete(key);return record??null}},
    fetcher:async()=>({ok:true,json:async()=>({id_token:'signed-token',access_token:'access-token',token_type:'Bearer'})}),
    clock:()=>NOW
  });
  const start=response();await service.handler({method:'GET',url:'/auth/central/start',headers:{}},start);
  const binding=start.headers['set-cookie'].split(';')[0];
  const oidcState=new URL(start.headers.location).searchParams.get('state');
  const callback=response();
  await service.handler({method:'GET',url:'/auth/central/callback?state='+oidcState+'&code=auth-code',headers:{cookie:binding}},callback);
  assert.equal(callback.status,200);
  assert.match(callback.body,/Choose your company/);
  assert.match(callback.body,/Alpha &amp; Co/);
  assert.equal(trace.length,0);
  const choiceState=/name="state" value="([^"]+)"/.exec(callback.body)?.[1];
  assert.ok(choices.has(choiceState));
  const request={method:'POST',url:'/auth/central/select',headers:{cookie:binding,origin:'https://central.example','content-type':'application/x-www-form-urlencoded'},
    async *[Symbol.asyncIterator](){yield Buffer.from('state='+choiceState+'&organisation_id='+B)}};
  const selected=response();await service.handler(request,selected);
  assert.equal(selected.status,303);
  assert.equal(selected.headers.location,'/central');
  assert.deepEqual(trace.map(x=>x[0]),['recheck','issue']);
  assert.deepEqual(trace.at(-1)[1],{identityId:'subject-123',companyId:B});
  const replay=response();await service.handler(request,replay);
  assert.equal(replay.status,403);
  assert.equal(trace.filter(x=>x[0]==='issue').length,1);
});


test('multi-company handshake propagates original OIDC company eligibility to one-use state',async()=>{
 const state=new Map(),choices=new Map();
 let nonce;let issued=0;
 const allowed='00000000-0000-4000-8000-000000000001';
 const second='00000000-0000-4000-8000-000000000002';
 const extra='00000000-0000-4000-8000-000000000003';
 const service=createCentralSignInService({
  pool:{connect:async()=>{throw Error('stores injected')}},
  sessions:{issue:async()=>{issued++;return {cookie:'__Host-titan-central='+'A'.repeat(43)}}},
  issuer:'https://issuer.example',clientId:'client',clientSecret:'secret',
  redirectUri:'https://central.example/auth/central/callback',
  enableCompanySelection:true,
  verifyIdToken:async()=>({sub:'subject',nonce,iss:'https://issuer.example',aud:'client',exp:Math.floor(NOW/1000)+120}),
  listEligibleCompanies:async()=>[{companyId:allowed,authorised:true},{companyId:second,authorised:true}],
  listOrganisations:async()=>[{id:allowed,name:'Allowed'},{id:second,name:'Second'},{id:extra,name:'Injected'}],
  recheckCompany:async()=>true,
  stateStore:{save:async(k,v)=>{state.set(k,v);nonce=v.nonce},consume:async k=>{const v=state.get(k);state.delete(k);return v}},
  selectionStore:{save:async(k,v)=>choices.set(k,v),consume:async k=>{const v=choices.get(k);choices.delete(k);return v}},
  fetcher:async()=>({ok:true,json:async()=>({id_token:'test',access_token:'test',token_type:'Bearer'})}),
  clock:()=>NOW
 });
 const start=response();await service.handler({method:'GET',url:'/auth/central/start',headers:{}},start);
 const cookie=start.headers['set-cookie'].split(';')[0];
 const oidcState=new URL(start.headers.location).searchParams.get('state');
 const result=response();await service.handler({method:'GET',
  url:'/auth/central/callback?state='+oidcState+'&code=code',headers:{cookie}},result);
 assert.equal(result.status,200);
 assert.doesNotMatch(result.body,/Injected/);
 assert.ok(choices.size===1);
 assert.deepEqual([...choices.values()][0].organisationIds,[allowed,second]);
 assert.equal(issued,0);
});


test('Central OIDC callback URI rejects nondefault registration ports',()=>{
 assert.throws(()=>createCentralSignInService({
  pool:{connect:async()=>{}},sessions:{issue:async()=>{}},
  issuer:'https://issuer.example',clientId:'id',clientSecret:'secret',
  redirectUri:'https://central.example:8443/auth/central/callback',
  verifyIdToken:async()=>{},listEligibleCompanies:async()=>[],
  recheckCompany:async()=>false,stateStore:{save:async()=>{},consume:async()=>{}}
 }),/exact callback path/);
});
