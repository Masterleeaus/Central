/** Integration: a trusted provisioning mutation bumps the generation that the session guard reads.
 * Uses an in-memory store behind the same SQL shapes; no network or database is used. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CentralProvisioner,TrustedProvisioningService} from '../../../packages/control-plane/dist/index.js';
import {createPostgresSessionRevocations} from '../src/session-revocation-pg.mjs';
import {createProtectedSessionGuard} from '../src/session-security.mjs';
const ORG='33333333-3333-4333-8333-333333333333',IDENT='44444444-4444-4444-8444-444444444444';
const reqId=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
/** One shared store per "database". Every pool or connection built from it sees the same rows. */
function makeDatabase({memberRevision=1,role='manager'}={}){
 const db={generations:new Map(),audit:[],activity:[],membership:{id:IDENT,organisation_id:ORG,role,state:'active',revision:memberRevision,logto_subject:'usr_1'},applied:0};
 const key=(a,s,o)=>[a,s,o].join('|');
 const handle=(q,p)=>{
  if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(q)||q.startsWith('SELECT pg_advisory'))return {rows:[],rowCount:0};
  if(q.startsWith("SELECT set_config('titan.organisation_id'"))return {rows:[{set_config:p[0]}],rowCount:1};
  if(q.startsWith('SELECT command_kind'))return {rows:db.audit.filter(a=>a.request_id===p[0]).map(a=>({command_kind:a.command_kind,command_digest:a.command_digest}))};
  if(q.includes('FOR UPDATE OF m'))return {rows:[{...db.membership}]};
  if(q.startsWith('UPDATE titan.memberships')){ if(db.membership.revision!==p[1])return {rowCount:0,rows:[]}; db.membership.role=p[2];db.membership.state=p[3];db.membership.revision++;return {rowCount:1,rows:[]}; }
  if(q.startsWith('INSERT INTO titan.titan_session_revocations')){const k=key(p[0],p[1],p[2]);const g=(db.generations.get(k)??0)+1;db.generations.set(k,g);return {rows:[{generation:g}],rowCount:1}; }
  if(q.startsWith('INSERT INTO titan.provisioning_audit')){db.audit.push({request_id:p[0],command_kind:p[3],command_digest:p[4]});return {rowCount:1,rows:[]}}
  if(q.startsWith('INSERT INTO titan.activity_events')){db.activity.push({organisation_id:p[2],action:p[5],correlation_id:p[10]});return {rowCount:1,rows:[]}}
  if(q.startsWith('SELECT generation FROM titan.titan_session_revocations')){const g=db.generations.get(key(p[0],p[1],p[2]));return {rows:g===undefined?[]:[{generation:g}]}}
  throw Error('unhandled SQL in fixture: '+q.slice(0,60));
 };
 const connect=async()=>({query:async(q,p)=>handle(q,p),release(){}});
 // A second, independent process sees the same database through its own pool.
 const pool=()=>({connect,query:async(q,p)=>handle(q,p)});
 return {db,pool};
}
const ctx=(n)=>({requestId:reqId(n),actorSubject:'admin_1',authorityReference:'policy:1'});
const actor={logtoSubject:'admin_1',operatorAuthorityVerified:true};
const logto={assertIdentity:async()=>{},assertOrganisation:async()=>{},assertMembership:async()=>{throw Error('membership removed in Logto')}};
const service=(pool)=>new TrustedProvisioningService(new CentralProvisioner(pool),logto,async()=>true,async(_t,id)=>id,async()=>true);
const guardFor=(pool,generation)=>createProtectedSessionGuard({applicationId:'desk',clock:()=>1000,
 loadSession:async()=>({applicationId:'desk',localUserId:'u1',localAccountId:'a1',organisationId:ORG,logtoSubject:'usr_1',generation,expiresAt:900000}),
 readVersion:args=>createPostgresSessionRevocations({pool}).readVersion(args),
 checkAccess:async()=>({allowed:true,applicationId:'desk',organisationId:ORG,localUserId:'u1',localAccountId:'a1'}),
 checkLocalAccount:async()=>true});

test('suspend bumps the generation and a session issued at generation 0 is rejected',async()=>{
 const {db,pool}=makeDatabase();
 assert.equal(await service(pool()).apply(actor,ctx(1),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'suspended'}),'updated');
 assert.equal(db.generations.get('desk|usr_1|'+ORG),1);
 assert.equal(db.generations.get('field|usr_1|'+ORG),1);
 assert.equal(db.generations.get('academy|usr_1|'+ORG),1);
 assert.equal((await guardFor(pool(),0)({sessionId:'sess_1'})).reason,'session_revoked');
});
test('a session issued after the bump at the current generation is still accepted by the guard',async()=>{
 const {pool}=makeDatabase();
 await service(pool()).apply(actor,ctx(2),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,role:'member'});
 assert.equal((await guardFor(pool(),1)({sessionId:'sess_2'})).allowed,true);
});
test('a second instance replaying the same request does not bump again',async()=>{
 const {db,pool}=makeDatabase();
 const cmd={kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'revoked'};
 assert.equal(await service(pool()).apply(actor,ctx(3),cmd),'updated');
 assert.equal(await service(pool()).apply(actor,ctx(3),cmd),'replayed');
 assert.equal(db.generations.get('desk|usr_1|'+ORG),1);
});
test('a stale instance with an old revision cannot revoke twice or bypass the check',async()=>{
 const {db,pool}=makeDatabase();
 await service(pool()).apply(actor,ctx(4),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'suspended'});
 await assert.rejects(service(pool()).apply(actor,ctx(5),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'revoked'}),/revision conflict/);
 assert.equal(db.generations.get('desk|usr_1|'+ORG),1);
 assert.equal(db.audit.length,1);
});
test('link revoke bumps only the linked application',async()=>{
 const {db,pool}=makeDatabase();
 const linkPool={connect:async()=>({query:async(q,p)=>{if(q.includes('FOR UPDATE OF l'))return {rows:[{organisation_id:ORG,application_id:'field',state:'verified',revision:1,logto_subject:'usr_1'}]};if(q.startsWith('UPDATE titan.local_account_links'))return {rowCount:1,rows:[]};return pool().query(q,p)},release(){}}),query:pool().query};
 await service(linkPool).apply(actor,ctx(6),{kind:'link_revoke',id:IDENT,organisationId:ORG,expectedRevision:1});
 assert.equal(db.generations.get('field|usr_1|'+ORG),1);assert.equal(db.generations.get('desk|usr_1|'+ORG),undefined);
});
