import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {LogtoManagementVerifier} from '../../../packages/control-plane/dist/logto-management.js';
import {createCentralHandler} from '../src/app.mjs';
import {createAdminHandler,createLogtoOperatorAuthoriser} from '../src/admin.mjs';

const ORIGINS={field:'https://field.titanzero.io',desk:'https://desk.titanzero.io',academy:'https://academy.titanzero.io'};
const AUDIENCES={field:'aud-field',desk:'aud-desk',academy:'aud-academy'};
const OPERATOR_ORG='org_operator';
const ROLE='role_titan_admin';
const ID='00000000-0000-4000-8000-000000000001';
const command={kind:'membership',id:ID,organisationId:ID,identityId:ID,role:'learner'};
const input={requestId:ID,authorityReference:'logto-audit:123',command};
const ok=value=>({ok:true,json:async()=>value});

/** Fake Logto tenant. `state` is mutated by tests to model membership and role changes. */
function fakeLogto(state={members:new Set(['op_admin']),roles:{op_admin:[ROLE]},fail:false}){
 const fetcher=async url=>{
  if(state.fail) return {ok:false,json:async()=>({})};
  const u=new URL(url);const p=u.pathname;
  if(/^\/api\/users\/[^/]+$/.test(p)) return ok({id:decodeURIComponent(p.split('/')[3])});
  const uo=p.match(/^\/api\/users\/([^/]+)\/organizations$/);
  if(uo){const uid=decodeURIComponent(uo[1]);return ok(state.members.has(uid)?[{id:OPERATOR_ORG}]:[]);}
  if(p===`/api/organizations/${OPERATOR_ORG}`) return ok({id:OPERATOR_ORG});
  if(p===`/api/organizations/${OPERATOR_ORG}/users`) return ok([...state.members].map(id=>({id})));
  const r=p.match(/^\/api\/organizations\/[^/]+\/users\/([^/]+)\/roles$/);
  if(r) return ok((state.roles[decodeURIComponent(r[1])]??[]).map(id=>({id})));
  return {ok:false,json:async()=>({})};
 };
 return {state,fetcher};
}

function verifierFor(logto){
 return new LogtoManagementVerifier({origin:'https://identity.example.test',accessToken:async()=> 'trusted-service-credential',fetcher:logto.fetcher,membershipCacheTtlMs:0});
}

/** Starts the real Central handler with the admin route installed. Returns a request function. */
async function start({logto=fakeLogto(),verifyToken=async()=>({logtoSubject:'op_admin'}),provision=async()=>'created',authoriseOperator}={}){
 const verifier=verifierFor(logto);
 const authorise=authoriseOperator??createLogtoOperatorAuthoriser({verifier,operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE]});
 const calls=[];
 const adminHandler=createAdminHandler({verifyToken,authoriseOperator:authorise,origins:ORIGINS,
  provision:async(...args)=>{calls.push(args);return provision(...args);}});
 const pool={connect:async()=>({query:async()=>({rows:[]}),release(){}})};
 const server=createServer(createCentralHandler({pool,verifyToken,issuer:'https://issuer.test',audiences:AUDIENCES,adminHandler}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const request=async(path,{method='POST',auth=true,body=input}={})=>{
  const headers=auth?{authorization:'Bearer abc.def.ghi'}:{};
  const opts={method,headers};
  if(body!==undefined){headers['content-type']='application/json';opts.body=JSON.stringify(body);}
  const res=await fetch(`http://127.0.0.1:${server.address().port}${path}`,opts);
  return {status:res.status,body:await res.json()};
 };
 return {request,calls,close:async()=>{server.close();await once(server,'close');}};
}

test('authoriser factory validates configuration', ()=>{
 const verifier=verifierFor(fakeLogto());
 assert.throws(()=>createLogtoOperatorAuthoriser({verifier,operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[]}),/role IDs/);
 assert.throws(()=>createLogtoOperatorAuthoriser({verifier,operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE,ROLE]}),/role IDs/);
 assert.throws(()=>createLogtoOperatorAuthoriser({verifier,operatorOrganisationId:'bad/id',administrativeRoleIds:[ROLE]}),/organisation ID/);
 assert.throws(()=>createLogtoOperatorAuthoriser({verifier:{},operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE]}),/verifier/);
});

test('authoriser grants an operator who is a member and holds the admin role', async()=>{
 const authorise=createLogtoOperatorAuthoriser({verifier:verifierFor(fakeLogto()),operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE]});
 assert.equal(await authorise({logtoSubject:'op_admin'}),true);
});

test('authoriser denies a member without the admin role', async()=>{
 const logto=fakeLogto({members:new Set(['op_admin']),roles:{op_admin:['role_other']},fail:false});
 const authorise=createLogtoOperatorAuthoriser({verifier:verifierFor(logto),operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE]});
 assert.equal(await authorise({logtoSubject:'op_admin'}),false);
});

test('authoriser denies an admin-role holder who is no longer a member', async()=>{
 const logto=fakeLogto({members:new Set(),roles:{op_admin:[ROLE]},fail:false});
 const authorise=createLogtoOperatorAuthoriser({verifier:verifierFor(logto),operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE]});
 assert.equal(await authorise({logtoSubject:'op_admin'}),false);
});

test('authoriser denies when the Logto management API rejects or is unreachable', async()=>{
 const logto=fakeLogto({members:new Set(['op_admin']),roles:{op_admin:[ROLE]},fail:true});
 const authorise=createLogtoOperatorAuthoriser({verifier:verifierFor(logto),operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE]});
 assert.equal(await authorise({logtoSubject:'op_admin'}),false);
});

test('authoriser rejects a principal without a valid subject before any Logto call', async()=>{
 const logto=fakeLogto();let calls=0;const f=logto.fetcher;logto.fetcher=async(...a)=>{calls++;return f(...a)};
 const authorise=createLogtoOperatorAuthoriser({verifier:verifierFor(logto),operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE]});
 assert.equal(await authorise({logtoSubject:'../admin'}),false);
 assert.equal(await authorise({}),false);
 assert.equal(calls,0);
});

test('unexpected authority errors propagate so the route answers 503', async()=>{
 const verifier=new LogtoManagementVerifier({origin:'https://identity.example.test',accessToken:async()=>{throw Error('credential store down')}});
 const authorise=createLogtoOperatorAuthoriser({verifier,operatorOrganisationId:OPERATOR_ORG,administrativeRoleIds:[ROLE]});
 await assert.rejects(authorise({logtoSubject:'op_admin'}),/credential store down/);
});

test('unauthenticated provisioning request is refused before any authority or write', async()=>{
 const s=await start();
 try{const r=await s.request('/v1/admin/provision',{auth:false});assert.equal(r.status,401);assert.equal(s.calls.length,0);}
 finally{await s.close();}
});

test('forged or invalid operator token is refused before any write', async()=>{
 const s=await start({verifyToken:async()=>{throw Error('bad signature')}});
 try{const r=await s.request('/v1/admin/provision');assert.equal(r.status,401);assert.equal(s.calls.length,0);}
 finally{await s.close();}
});

test('operator without Logto admin role is forbidden and nothing is written', async()=>{
 const logto=fakeLogto({members:new Set(['op_admin']),roles:{op_admin:[]},fail:false});
 const s=await start({logto});
 try{const r=await s.request('/v1/admin/provision');assert.equal(r.status,403);assert.equal(r.body.error,'forbidden');assert.equal(s.calls.length,0);}
 finally{await s.close();}
});

test('authorised operator reaches provisioning with a verified actor derived from the token', async()=>{
 const s=await start();
 try{
  const r=await s.request('/v1/admin/provision');
  assert.equal(r.status,201);
  assert.equal(s.calls.length,1);
  assert.equal(s.calls[0][0].logtoSubject,'op_admin');
  assert.equal(s.calls[0][0].operatorAuthorityVerified,true);
  assert.equal(s.calls[0][1].actorSubject,'op_admin');
 }finally{await s.close();}
});

test('the operator authority marker is never true unless authoriseOperator returned true', async()=>{
 const s=await start({authoriseOperator:async()=>false});
 try{const r=await s.request('/v1/admin/provision');assert.equal(r.status,403);assert.equal(s.calls.length,0);}
 finally{await s.close();}
});

test('authority outage answers 503 and performs no write', async()=>{
 const s=await start({authoriseOperator:async()=>{throw Error('logto unreachable')}});
 try{const r=await s.request('/v1/admin/provision');assert.equal(r.status,503);assert.equal(r.body.error,'authority_unavailable');assert.equal(s.calls.length,0);}
 finally{await s.close();}
});

test('replayed request with the same requestId is idempotent and not written twice', async()=>{
 const seen=new Set();
 const s=await start({provision:async(_actor,context)=>{
  if(seen.has(context.requestId))return 'replayed';
  seen.add(context.requestId);return 'created';
 }});
 try{
  const first=await s.request('/v1/admin/provision');
  const second=await s.request('/v1/admin/provision');
  assert.equal(first.status,201);
  assert.equal(second.status,200);
  assert.equal(second.body.status,'replayed');
  assert.equal(seen.size,1);
 }finally{await s.close();}
});

test('replay after the operator lost the admin role is forbidden', async()=>{
 const logto=fakeLogto();
 const s=await start({logto});
 try{
  assert.equal((await s.request('/v1/admin/provision')).status,201);
  logto.state.roles.op_admin=[];
  const replay=await s.request('/v1/admin/provision');
  assert.equal(replay.status,403);
  assert.equal(s.calls.length,1);
 }finally{await s.close();}
});
