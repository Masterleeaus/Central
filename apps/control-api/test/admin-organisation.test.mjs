import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createCentralHandler} from '../src/app.mjs';
import {createAdminHandler} from '../src/admin.mjs';
import {CentralProvisioner} from '../../../packages/control-plane/dist/provisioning.js';
import {TrustedProvisioningService} from '../../../packages/control-plane/dist/trusted-provisioning.js';
import {createTenantAdministrationAuthorizer,createPostgresTenantAdministrationStore} from '../../../packages/control-plane/dist/administration.js';
import {LogtoAuthorityError} from '../../../packages/control-plane/dist/logto-management.js';

const ORIGINS={field:'https://field.titanzero.io',desk:'https://desk.titanzero.io',academy:'https://academy.titanzero.io'};
const AUDIENCES={field:'aud-field',desk:'aud-desk',academy:'aud-academy'};
const ORG_A='aaaaaaaa-0000-4000-8000-00000000000a', ORG_B='bbbbbbbb-0000-4000-8000-00000000000b';
const ID=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const LOGTO_A='org_a', LOGTO_B='org_b', ROLE='role_tenant_admin';
const I={admin:ID(1),owner:ID(2),member:ID(3),manager:ID(4),other:ID(5),newbie:ID(6),operator:ID(7)};
const M={adminA:ID(101),ownerA:ID(102),memberA:ID(103),managerA:ID(104),memberB:ID(105)};
const seq=(()=>{let n=500;return()=>ID(++n);})();

/** In-memory fake of the only statements the provisioner and tenant policy issue. Unknown SQL fails loudly. */
function fakeDb(){
 const db={identities:[{id:I.admin,logto_subject:'usr_admin',state:'active'},{id:I.owner,logto_subject:'usr_owner',state:'active'},{id:I.member,logto_subject:'usr_member',state:'active'},{id:I.manager,logto_subject:'usr_manager',state:'active'},{id:I.other,logto_subject:'usr_other',state:'active'},{id:I.newbie,logto_subject:'usr_newbie',state:'active'}],
  memberships:[
   {id:M.adminA,identity_id:I.admin,organisation_id:ORG_A,role:'admin',state:'active',expires_at:null,revision:1},
   {id:M.ownerA,identity_id:I.owner,organisation_id:ORG_A,role:'owner',state:'active',expires_at:null,revision:1},
   {id:M.memberA,identity_id:I.member,organisation_id:ORG_A,role:'member',state:'active',expires_at:null,revision:1},
   {id:M.managerA,identity_id:I.manager,organisation_id:ORG_A,role:'manager',state:'active',expires_at:null,revision:1},
   {id:M.memberB,identity_id:I.other,organisation_id:ORG_B,role:'member',state:'active',expires_at:null,revision:1}],
  audit:[], activity:[], writes:[], revocations:new Map()};
 const run=(sql,p)=>{
  const s=sql.replace(/\s+/g,' ').trim();
  if(/^(BEGIN|COMMIT|ROLLBACK|SET |SELECT set_config|SELECT pg_advisory)/.test(s)) return {rows:[],rowCount:0};
  if(s.startsWith('SELECT command_kind')) return {rows:db.audit.filter(a=>a.request_id===p[0]).map(a=>({command_kind:a.command_kind,command_digest:a.digest})),rowCount:0};
  if(s.startsWith('SELECT m.id, m.identity_id, m.role FROM titan.memberships m JOIN titan.identities i')){
   const rows=db.memberships.filter(m=>m.organisation_id===p[1]&&m.state==='active'&&db.identities.find(i=>i.id===m.identity_id&&i.logto_subject===p[0]&&i.state==='active'))
    .map(m=>({id:m.id,identity_id:m.identity_id,role:m.role}));return {rows,rowCount:rows.length};}
  if(s.startsWith('SELECT m.id, m.identity_id, i.logto_subject, m.role, m.state, m.revision FROM titan.memberships m JOIN titan.identities i') && s.includes('WHERE m.id=$1 AND m.organisation_id=$2')){
   const rows=db.memberships.filter(m=>m.id===p[0]&&m.organisation_id===p[1]).map(m=>({id:m.id,identity_id:m.identity_id,logto_subject:db.identities.find(i=>i.id===m.identity_id).logto_subject,role:m.role,state:m.state,revision:m.revision}));
   return {rows,rowCount:rows.length};}
  if(s.startsWith('SELECT m.organisation_id, m.role, m.state, m.revision, i.logto_subject')){
   const m=db.memberships.find(x=>x.id===p[0]);
   return {rows:m?[{organisation_id:m.organisation_id,role:m.role,state:m.state,revision:m.revision,logto_subject:db.identities.find(i=>i.id===m.identity_id).logto_subject}]:[],rowCount:m?1:0};}
  if(s.startsWith('UPDATE titan.memberships SET role=$3')){
   const m=db.memberships.find(x=>x.id===p[0]&&x.revision===p[1]);
   if(m){m.role=p[2];m.state=p[3];m.revision+=1;db.writes.push(['update_membership',p[0]]);}
   return {rows:[],rowCount:m?1:0};}
  if(s.startsWith('INSERT INTO titan.memberships(')){
   const dup=db.memberships.some(m=>m.identity_id===p[1]&&m.organisation_id===p[2]);
   if(!dup){db.memberships.push({id:p[0],identity_id:p[1],organisation_id:p[2],role:p[3],state:'active',expires_at:null,revision:1});db.writes.push(['insert_membership',p[0]]);}
   return {rows:dup?[]:[{id:p[0]}],rowCount:dup?0:1};}
  if(s.startsWith('INSERT INTO titan.identities')){db.writes.push(['insert_identity',p[0]]);return {rows:[{id:p[0]}],rowCount:1};}
  if(s.startsWith('INSERT INTO titan.titan_session_revocations')){
   const k=`${p[0]}|${p[1]}|${p[2]}`;const g=(db.revocations.get(k)??0)+1;db.revocations.set(k,g);return {rows:[{generation:g}],rowCount:1};}
  if(s.startsWith('INSERT INTO titan.activity_events')){db.activity.push({event_id:p[0],action:p[5]});return {rows:[],rowCount:1};}
  if(s.startsWith('INSERT INTO titan.provisioning_audit')){db.audit.push({request_id:p[0],actor:p[1],authority:p[2],command_kind:p[3],digest:p[4],subject:p[5]});return {rows:[],rowCount:1};}
  throw Error('unexpected SQL in fake: '+s.slice(0,80));
 };
 const pool={async connect(){return {async query(sql,params=[]){return run(sql,params);},release(){}};}};
 return {db,pool};
}

/** Fake Logto: members is "user|org" pairs; roles maps user to Logto organisation role IDs. */
function fakeLogto(){
 const state={members:new Set(['usr_newbie|org_a','usr_other|org_a','usr_admin|org_a','usr_owner|org_a','usr_member|org_a','usr_manager|org_a','usr_other|org_b','usr_operator|org_op']),roles:{usr_admin:[ROLE],usr_owner:[ROLE],usr_other:[ROLE],usr_operator:['role_op']},fail:false};
 const verifier={
  async assertIdentity(){}, async assertOrganisation(){},
  async assertMembership(u,o){if(state.fail)throw Error('logto unavailable');if(!state.members.has(`${u}|${o}`))throw new LogtoAuthorityError();},
  async assertAnyOrganisationRole(u,o,roles){if(state.fail)throw Error('logto unavailable');if(!(state.roles[u]??[]).some(r=>roles.includes(r)))throw new LogtoAuthorityError();},
 };
 return {state,verifier};
}
const TOKENS={tok_admin:'usr_admin',tok_owner:'usr_owner',tok_member:'usr_member',tok_other:'usr_other',tok_operator:'usr_operator',tok_nobody:'usr_nobody'};
const RESOLVE={organisation:{[ORG_A]:LOGTO_A,[ORG_B]:LOGTO_B},identity:{[I.admin]:'usr_admin',[I.owner]:'usr_owner',[I.member]:'usr_member',[I.manager]:'usr_manager',[I.other]:'usr_other',[I.newbie]:'usr_newbie'}};

/** Builds the real tenant pipeline: policy -> TrustedProvisioningService -> CentralProvisioner, over the fakes. */
function tenantPipeline({db,logto,pool}){
 const resolve=async(type,id)=>RESOLVE[type][id];
 const authorize=createTenantAdministrationAuthorizer({verifier:logto.verifier,resolve,administrativeRoleIds:[ROLE],store:createPostgresTenantAdministrationStore(pool)});
 return new TrustedProvisioningService(new CentralProvisioner(pool),logto.verifier,authorize,resolve,async()=>false);
}

async function start({verifyTokenFails=false,withTenant=true,withRead=true,logto,db,pool,tenantService}={}){
 const verifyToken=async(t)=>{if(!TOKENS[t])throw Error('bad token');return {logtoSubject:TOKENS[t]};};
 const authoriseOperator=async(p)=>p.logtoSubject==='usr_operator';
 const readOrganisation=async(id)=>(id===ORG_A?{organisation:{id:ORG_A,logtoOrganisationId:LOGTO_A,state:'active'},memberships:[{id:M.adminA}],entitlements:[],links:[]}:id===ORG_B?{organisation:{id:ORG_B},memberships:[{id:M.memberB}],entitlements:[],links:[]}:undefined);
 const provisionTenant=withTenant?(actor,ctx,cmd)=>tenantService.apply(actor,ctx,cmd):undefined;
 const handler=createAdminHandler({verifyToken,authoriseOperator,origins:ORIGINS,provisionTenant,readOrganisation:withRead?readOrganisation:undefined,logger:()=>{}});
 const s=createServer(createCentralHandler({pool:{connect:async()=>({query:async()=>({rows:[]}),release(){}})},verifyToken,issuer:'https://issuer.test',audiences:AUDIENCES,adminHandler:handler}));
 s.listen(0,'127.0.0.1');await once(s,'listening');
 return {
  async call(path,{method='GET',token='tok_admin',body,raw,auth=true}={}){
   const headers=auth?{authorization:`Bearer ${token}`}:{};
   const opts={method,headers};
   if(body!==undefined||raw!==undefined){headers['content-type']='application/json';opts.body=raw??JSON.stringify(body);}
   const res=await fetch(`http://127.0.0.1:${s.address().port}${path}`,opts);
   return {status:res.status,body:await res.json().catch(()=>({}))};
  },
  close(){s.close();return once(s,'close');}
 };
}
const req=(command,{requestId=seq(),token='tok_admin'}={})=>({method:'POST',path:'/v1/admin/tenant/provision',token,body:{requestId,authorityReference:'logto-audit:2026-11-09',command}});
const membershipUpdate=(id,extra,org=ORG_A)=>({kind:'membership_update',id,organisationId:org,expectedRevision:1,...extra});
async function withTenant(fn,opts={}){
 const {db,pool}=fakeDb();const logto=fakeLogto();if(opts.setup)opts.setup({db,logto});
 const tenantService=tenantPipeline({db,logto,pool});
 const srv=await start({...opts,db,pool,logto,tenantService});
 try{await fn({db,logto,srv});}finally{await srv.close();}
}
const send=(srv,r)=>srv.call(r.path,{method:'POST',token:r.token,body:r.body});

// ---------- operator read path ----------
test('operator reads one organisation with memberships, entitlements and links',async()=>withTenant(async({srv})=>{
 const r=await srv.call(`/v1/admin/organisations/${ORG_A}/access`,{token:'tok_operator'});
 assert.equal(r.status,200);assert.equal(r.body.organisation.id,ORG_A);assert.deepEqual(r.body.memberships.map(m=>m.id),[M.adminA]);
}));
test('read returns only the requested organisation, never another tenant',async()=>withTenant(async({srv})=>{
 const r=await srv.call(`/v1/admin/organisations/${ORG_B}/access`,{token:'tok_operator'});
 assert.equal(r.status,200);assert.deepEqual(r.body.memberships.map(m=>m.id),[M.memberB]);assert.ok(!JSON.stringify(r.body).includes(M.adminA));
}));
test('read of an unknown organisation returns 404',async()=>withTenant(async({srv})=>{
 assert.equal((await srv.call(`/v1/admin/organisations/${ID(999)}/access`,{token:'tok_operator'})).status,404);
}));
test('read is refused to tenant administrators and members (operator authority only)',async()=>withTenant(async({srv})=>{
 assert.equal((await srv.call(`/v1/admin/organisations/${ORG_A}/access`,{token:'tok_admin'})).status,403);
 assert.equal((await srv.call(`/v1/admin/organisations/${ORG_A}/access`,{token:'tok_member'})).status,403);
}));
test('read fails closed without a token or with a bad token',async()=>withTenant(async({srv})=>{
 assert.equal((await srv.call(`/v1/admin/organisations/${ORG_A}/access`,{auth:false})).status,401);
 assert.equal((await srv.call(`/v1/admin/organisations/${ORG_A}/access`,{token:'tok_forged'})).status,401);
}));
test('read rejects other methods, query strings and malformed organisation IDs',async()=>withTenant(async({srv})=>{
 assert.equal((await srv.call(`/v1/admin/organisations/${ORG_A}/access`,{method:'POST',body:{}})).status,405);
 assert.equal((await srv.call(`/v1/admin/organisations/${ORG_A}/access?all=1`,{token:'tok_operator'})).status,400);
 assert.equal((await srv.call(`/v1/admin/organisations/*/access`,{token:'tok_operator'})).status,404);
}));
test('read is disabled unless the reader is wired',async()=>{
 const {db,pool}=fakeDb();const logto=fakeLogto();const srv=await start({withRead:false,db,pool,logto,tenantService:tenantPipeline({db,logto,pool})});
 try{assert.equal((await srv.call(`/v1/admin/organisations/${ORG_A}/access`,{token:'tok_operator'})).status,503);}finally{await srv.close();}
});
test('read failure does not leak detail',async()=>{
 const {db,pool}=fakeDb();const logto=fakeLogto();
 const verifyToken=async()=>({logtoSubject:'usr_operator'});
 const handler=createAdminHandler({verifyToken,authoriseOperator:async()=>true,origins:ORIGINS,readOrganisation:async()=>{throw Error('connection string postgres://secret')}});
 const s=createServer(createCentralHandler({pool,verifyToken,issuer:'https://issuer.test',audiences:AUDIENCES,adminHandler:handler}));s.listen(0,'127.0.0.1');await once(s,'listening');
 try{const res=await fetch(`http://127.0.0.1:${s.address().port}/v1/admin/organisations/${ORG_A}/access`,{headers:{authorization:'Bearer x.y'}});const txt=await res.text();assert.equal(res.status,503);assert.ok(!txt.includes('secret'));}
 finally{s.close();await once(s,'close');}
});

// ---------- tenant administration path ----------
test('tenant admin invites a member at a delegable role; no identity is created',async()=>withTenant(async({srv,db})=>{
 const r=await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'member'}));
 assert.equal(r.status,201);assert.equal(r.body.status,'created');
 assert.ok(db.memberships.some(m=>m.identity_id===I.newbie&&m.organisation_id===ORG_A&&m.role==='member'));
 assert.deepEqual(db.writes.filter(([k])=>k==='insert_identity'),[]);
 assert.equal(db.audit.at(-1).actor,'usr_admin');
}));
test('tenant admin changes a member role downward and suspends a manager with session revocation and audit',async()=>withTenant(async({srv,db})=>{
 const demote=await send(srv,req(membershipUpdate(M.managerA,{role:'member',expectedRevision:1})));
 assert.equal(demote.status,200);assert.equal(demote.body.status,'updated');
 const suspend=await send(srv,req(membershipUpdate(M.memberA,{state:'suspended',expectedRevision:1})));
 assert.equal(suspend.status,200);
 const row=db.memberships.find(m=>m.id===M.memberA);assert.equal(row.state,'suspended');assert.equal(row.revision,2);
 for(const app of ['desk','field','academy']) assert.equal(db.revocations.get(`${app}|usr_member|${ORG_A}`),1,`revoked for ${app}`);
 assert.ok(db.audit.some(a=>a.request_id===undefined||a.command_kind==='membership_update'));
}));
test('a promotion does not trigger session revocation',async()=>withTenant(async({srv,db})=>{
 const r=await send(srv,req(membershipUpdate(M.memberA,{role:'manager',expectedRevision:1})));
 assert.equal(r.status,200);assert.equal(db.revocations.size,0);
}));
test('stale expected revision is a conflict and changes nothing',async()=>withTenant(async({srv,db})=>{
 const r=await send(srv,req(membershipUpdate(M.memberA,{state:'suspended',expectedRevision:7})));
 assert.equal(r.status,409);assert.equal(r.body.error,'revision_conflict');
 assert.equal(db.memberships.find(m=>m.id===M.memberA).state,'active');assert.equal(db.revocations.size,0);
}));
test('membership_update without expectedRevision is rejected as invalid',async()=>withTenant(async({srv,db})=>{
 const {expectedRevision,...rest}=membershipUpdate(M.memberA,{state:'suspended'});
 assert.equal((await send(srv,req(rest))).status,400);assert.equal(db.writes.length,0);
}));
test('escalation: tenant admin cannot grant admin (own role) or owner',async()=>withTenant(async({srv,db})=>{
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'admin'}))).status,403);
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'owner'}))).status,403);
 assert.equal((await send(srv,req(membershipUpdate(M.memberA,{role:'owner'})))).status,403);
 assert.equal((await send(srv,req(membershipUpdate(M.memberA,{role:'admin'})))).status,403);
 assert.equal(db.writes.length,0);
}));
test('tenant admin cannot change an owner or a peer administrator',async()=>withTenant(async({srv,db})=>{
 assert.equal((await send(srv,req(membershipUpdate(M.ownerA,{state:'suspended'})))).status,403);
 assert.equal((await send(srv,req(membershipUpdate(M.adminA,{state:'suspended'})))).status,403);
 assert.equal(db.writes.length,0);
}));
test('tenant admin cannot change their own membership',async()=>withTenant(async({srv,db})=>{
 assert.equal((await send(srv,req(membershipUpdate(M.adminA,{role:'manager'})))).status,403);
 assert.equal(db.writes.length,0);
}));
test('owner may grant admin but still not owner',async()=>withTenant(async({srv})=>{
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'admin'},{token:'tok_owner'}))).status,201);
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.other,organisationId:ORG_A,role:'owner'},{token:'tok_owner'}))).status,403);
}));
test('cross-tenant: a membership of another organisation cannot be changed through this organisation',async()=>withTenant(async({srv,db})=>{
 const r=await send(srv,req(membershipUpdate(M.memberB,{state:'suspended'},ORG_A)));
 assert.equal(r.status,403);assert.equal(db.memberships.find(m=>m.id===M.memberB).state,'active');assert.equal(db.writes.length,0);
}));
test('cross-tenant: an admin of A cannot add a membership to organisation B',async()=>withTenant(async({srv,db})=>{
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_B,role:'member'}))).status,403);
 assert.equal(db.writes.length,0);
}));
test('a plain member, a manager and an unrelated operator are refused',async()=>withTenant(async({srv,db})=>{
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'learner'},{token:'tok_member'}))).status,403);
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'learner'},{token:'tok_operator'}))).status,403);
 assert.equal(db.writes.length,0);
}));
test('tenant route refuses identity, organisation, entitlement and link commands',async()=>withTenant(async({srv,db})=>{
 assert.equal((await send(srv,req({kind:'identity',id:seq(),logtoSubject:'usr_new'}))).status,403);
 assert.equal((await send(srv,req({kind:'organisation',id:seq(),logtoOrganisationId:'org_new'}))).status,403);
 assert.equal((await send(srv,req({kind:'link',id:seq(),identityId:I.member,organisationId:ORG_A,applicationId:'desk',localUserId:'u',localAccountId:'a',assertion:'a.b.c'}))).status,403);
 assert.equal((await send(srv,req({kind:'entitlement',id:seq(),organisationId:ORG_A,applicationId:'desk',features:[]}))).status,403);
 assert.equal((await send(srv,req({kind:'link_revoke',id:seq(),organisationId:ORG_A,expectedRevision:1}))).status,403);
 assert.equal(db.writes.length,0);
}));
test('tenant route refuses an admin with no Logto administrator role',async()=>withTenant(async({srv,db,logto})=>{
 logto.state.roles.usr_admin=[];
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'member'}))).status,403);
 assert.equal(db.writes.length,0);
}));
test('Logto infrastructure failure is 503 and writes nothing',async()=>withTenant(async({srv,db,logto})=>{
 logto.state.fail=true;
 assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'member'}))).status,503);
 assert.equal(db.writes.length,0);
}));
test('tenant route is unauthenticated without a token and disabled without the injected service',async()=>{
 await withTenant(async({srv})=>{
  assert.equal((await srv.call('/v1/admin/tenant/provision',{method:'POST',auth:false,body:{}})).status,401);
  assert.equal((await srv.call('/v1/admin/tenant/provision',{method:'GET'})).status,405);
 });
 const {db,pool}=fakeDb();const logto=fakeLogto();
 const srv=await start({withTenant:false,db,pool,logto,tenantService:tenantPipeline({db,logto,pool})});
 try{assert.equal((await send(srv,req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'member'}))).status,503);}finally{await srv.close();}
});
test('a replayed request ID returns the original result without a second write',async()=>withTenant(async({srv,db})=>{
 const r=req({kind:'membership',id:seq(),identityId:I.newbie,organisationId:ORG_A,role:'member'});
 assert.equal((await send(srv,r)).status,201);
 assert.equal((await send(srv,r)).status,200);
 assert.equal(db.writes.filter(([k])=>k==='insert_membership').length,1);
}));
