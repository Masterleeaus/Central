import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {readOperatorConfig} from '../src/operator-config.mjs';
import {startCentralService} from '../src/server.mjs';

const ORG='org_operator_1';
const ROLE='role_admin_1';
const SECRET='sentinel-m2m-secret-DO-NOT-LEAK-9f2c';
const MGMT_TOKEN='mgmt-access-token-VALUE-7d1e';
const OP_SUBJECT='op_subject_sentinel_77';
const BASE={
 TITAN_CENTRAL_DATABASE_URL:'postgres://unused.example.test/titan_central',
 TITAN_OIDC_ISSUER:'https://issuer.example.test',
 TITAN_OIDC_JWKS_URI:'https://issuer.example.test/jwks',
 TITAN_FIELD_AUDIENCE:'aud-field',TITAN_DESK_AUDIENCE:'aud-desk',TITAN_ACADEMY_AUDIENCE:'aud-academy',
};
const OPERATOR={
 TITAN_OPERATOR_ORGANISATION_ID:ORG,
 TITAN_OPERATOR_ROLE_IDS:ROLE,
 TITAN_LOGTO_MANAGEMENT_ORIGIN:'https://logto.example.test',
 TITAN_LOGTO_M2M_CLIENT_ID:'m2m-client-1',
 TITAN_LOGTO_M2M_CLIENT_SECRET:SECRET,
 TITAN_LOGTO_MANAGEMENT_RESOURCE:'https://logto.example.test/api',
 TITAN_LOGTO_MANAGEMENT_SCOPE:'all',
 TITAN_DESK_ORIGIN:'https://desk.example.test',
 TITAN_FIELD_ORIGIN:'https://field.example.test',
 TITAN_ACADEMY_ORIGIN:'https://academy.example.test',
};

class FakePool{ async query(){return {rows:[]};} async connect(){return {query:async()=>({rows:[]}),release(){}};} async end(){} }
const loadPg=async()=>({Pool:FakePool});
const ok=value=>({ok:true,status:200,json:async()=>value});

/** Fake Logto: token endpoint and Management API. Records every outgoing call. */
function fakeLogto({members=[],roles={},tokenStatus=200,tokenEcho=false}={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url:String(url),init});
  const u=new URL(url);const p=u.pathname;
  if(p==='/oidc/token'){
   if(tokenStatus!==200) return {ok:false,status:tokenStatus,json:async()=>({error:tokenEcho?`bad secret ${SECRET}`:'server_error'})};
   return ok({access_token:MGMT_TOKEN,token_type:'Bearer',expires_in:300});
  }
  if(/^\/api\/users\/[^/]+$/.test(p)) return ok({id:decodeURIComponent(p.split('/')[3])});
  const uo=p.match(/^\/api\/users\/([^/]+)\/organizations$/);
  if(uo){const uid=decodeURIComponent(uo[1]);return ok(members.includes(uid)?[{id:ORG}]:[]);}
  if(p===`/api/organizations/${ORG}`) return ok({id:ORG});
  if(p===`/api/organizations/${ORG}/users`) return ok(members.map(id=>({id})));
  const r=p.match(/^\/api\/organizations\/[^/]+\/users\/([^/]+)\/roles$/);
  if(r) return ok((roles[decodeURIComponent(r[1])]??[]).map(id=>({id})));
  return {ok:false,status:404,json:async()=>({})};
 };
 return {fetcher,calls};
}

const verifyToken=async token=>{if(token==='operator-token')return {logtoSubject:OP_SUBJECT};throw new Error('invalid token');};

function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}

async function start(env={},{fetcher,logger}={}){
 const port=await freePort();
 return startCentralService({env:{...BASE,...env,TITAN_CENTRAL_PORT:String(port)},loadPg,fetcher,verifyToken,logger});
}
async function call(service,path,{method='GET',bearer}={}){
 const port=service.server.address().port;
 const res=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:bearer?{authorization:`Bearer ${bearer}`}:{}});
 return {status:res.status,text:await res.text()};
}

test('unset operator variables give no operator config', ()=>{
 assert.equal(readOperatorConfig({}),null);
 assert.equal(readOperatorConfig({TITAN_OPERATOR_ORGANISATION_ID:'',TITAN_OPERATOR_ROLE_IDS:''}),null);
});

test('operator config must be set as a pair', ()=>{
 assert.throws(()=>readOperatorConfig({TITAN_OPERATOR_ORGANISATION_ID:ORG}),/set together/);
 assert.throws(()=>readOperatorConfig({TITAN_OPERATOR_ROLE_IDS:ROLE}),/set together/);
});

test('malformed operator IDs and role lists are rejected, including the template placeholder', ()=>{
 const bad=[
  {TITAN_OPERATOR_ORGANISATION_ID:'REPLACE_ME',TITAN_OPERATOR_ROLE_IDS:ROLE},
  {TITAN_OPERATOR_ORGANISATION_ID:'org/with/slash',TITAN_OPERATOR_ROLE_IDS:ROLE},
  {TITAN_OPERATOR_ORGANISATION_ID:ORG,TITAN_OPERATOR_ROLE_IDS:'REPLACE_ME'},
  {TITAN_OPERATOR_ORGANISATION_ID:ORG,TITAN_OPERATOR_ROLE_IDS:`${ROLE},,role_b`},
  {TITAN_OPERATOR_ORGANISATION_ID:ORG,TITAN_OPERATOR_ROLE_IDS:`${ROLE},${ROLE}`},
  {TITAN_OPERATOR_ORGANISATION_ID:ORG,TITAN_OPERATOR_ROLE_IDS:`${ROLE},`},
  {TITAN_OPERATOR_ORGANISATION_ID:ORG,TITAN_OPERATOR_ROLE_IDS:Array.from({length:33},(_,i)=>`r${i}`).join(',')},
 ];
 for(const env of bad) assert.throws(()=>readOperatorConfig(env),/invalid TITAN_OPERATOR|set together/);
});

test('valid operator IDs parse with whitespace trimmed', ()=>{
 assert.deepEqual(readOperatorConfig({TITAN_OPERATOR_ORGANISATION_ID:ORG,TITAN_OPERATOR_ROLE_IDS:` ${ROLE} , role_b `}),{organisationId:ORG,roleIds:[ROLE,'role_b']});
});

test('unset operator config: service starts, admin routes answer 404 and Logto is never contacted', async()=>{
 const logto=fakeLogto();
 const service=await start({},{fetcher:logto.fetcher});
 try{
  const admin=await call(service,'/v1/admin/oidc/plans');
  assert.equal(admin.status,404);
  assert.deepEqual(JSON.parse(admin.text),{error:'not_found'});
  assert.equal((await call(service,'/healthz')).status,200);
  assert.equal(logto.calls.length,0);
 }finally{await service.close();}
});

test('valid operator config mounts the admin route, with no Logto call at startup', async()=>{
 const logto=fakeLogto();
 const service=await start(OPERATOR,{fetcher:logto.fetcher});
 try{
  assert.equal(logto.calls.length,0);
  const unauth=await call(service,'/v1/admin/oidc/plans');
  assert.equal(unauth.status,401);
  assert.deepEqual(JSON.parse(unauth.text),{error:'unauthenticated'});
 }finally{await service.close();}
});

test('mounted route denies a verified operator who is not an organisation member', async()=>{
 const logto=fakeLogto({members:[]});
 const service=await start(OPERATOR,{fetcher:logto.fetcher});
 try{
  const r=await call(service,'/v1/admin/oidc/plans',{bearer:'operator-token'});
  assert.equal(r.status,403);
  assert.deepEqual(JSON.parse(r.text),{error:'forbidden'});
  assert.ok(logto.calls.some(c=>c.url.endsWith('/oidc/token')));
 }finally{await service.close();}
});

test('mounted route allows a member holding the administrator role, and no secret reaches the response', async()=>{
 const logto=fakeLogto({members:[OP_SUBJECT],roles:{[OP_SUBJECT]:[ROLE]}});
 const service=await start(OPERATOR,{fetcher:logto.fetcher});
 try{
  const r=await call(service,'/v1/admin/oidc/plans',{bearer:'operator-token'});
  assert.equal(r.status,200);
  const body=JSON.parse(r.text);
  assert.equal(body.registrationStatus,'not_registered');
  assert.equal(body.applications.length,3);
  assert.ok(!r.text.includes(SECRET)&&!r.text.includes(MGMT_TOKEN));
 }finally{await service.close();}
});

test('malformed operator settings make startup throw', async()=>{
 const logto=fakeLogto();
 const variants=[
  {TITAN_LOGTO_MANAGEMENT_ORIGIN:'http://logto.example.test'},
  {TITAN_LOGTO_MANAGEMENT_ORIGIN:'https://logto.example.test/tenant'},
  {TITAN_LOGTO_MANAGEMENT_ORIGIN:'REPLACE_ME'},
  {TITAN_LOGTO_MANAGEMENT_RESOURCE:'http://logto.example.test/api'},
  {TITAN_LOGTO_M2M_CLIENT_SECRET:undefined},
  {TITAN_LOGTO_M2M_CLIENT_SECRET:'REPLACE_ME'},
  {TITAN_LOGTO_MANAGEMENT_SCOPE:'REPLACE_ME'},
  {TITAN_DESK_ORIGIN:'https://desk.example.test/app'},
  {TITAN_FIELD_ORIGIN:'https://desk.example.test'},
  {TITAN_OPERATOR_ROLE_IDS:`${ROLE},${ROLE}`},
  {TITAN_OPERATOR_ORGANISATION_ID:'REPLACE_ME'},
 ];
 for(const variant of variants){
  const env={...OPERATOR,...variant};
  for(const k of Object.keys(env)) if(env[k]===undefined) delete env[k];
  await assert.rejects(start(env,{fetcher:logto.fetcher}),err=>{
   assert.ok(err instanceof Error);
   assert.ok(!String(err.message).includes(SECRET),'error must not echo the client secret');
   return true;
  });
 }
});

test('a partly configured operator plane fails startup even when the secret is valid', async()=>{
 const env={...OPERATOR};delete env.TITAN_OPERATOR_ROLE_IDS;
 await assert.rejects(start(env,{fetcher:fakeLogto().fetcher}),/set together/);
});

test('Logto failure is answered 503 and neither the secret nor the management token leaks into responses or logs', async()=>{
 const logto=fakeLogto({tokenStatus:500,tokenEcho:true});
 const logLines=[];
 const service=await start(OPERATOR,{fetcher:logto.fetcher,logger:(event,fields)=>logLines.push(JSON.stringify({event,fields}))});
 try{
  const r=await call(service,'/v1/admin/oidc/plans',{bearer:'operator-token'});
  assert.equal(r.status,503);
  assert.deepEqual(JSON.parse(r.text),{error:'authority_unavailable'});
  assert.ok(!r.text.includes(SECRET)&&!r.text.includes(MGMT_TOKEN));
  const everything=logLines.join('\n')+r.text;
  assert.ok(!everything.includes(SECRET),'secret must not appear in logs');
  assert.ok(!everything.includes(MGMT_TOKEN),'management token must not appear in logs');
  assert.ok(!everything.includes(OP_SUBJECT),'operator subject must not appear in logs');
  assert.ok(!(await call(service,'/metrics')).text.includes(SECRET));
 }finally{await service.close();}
});
