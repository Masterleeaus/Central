import test from 'node:test';
import assert from 'node:assert/strict';
import { CentralProvisioner } from '../dist/provisioning.js';
const id='22222222-2222-4222-8222-222222222222';
const requestId='11111111-1111-4111-8111-111111111111';
const context={requestId,actorSubject:'management:operator',authorityReference:'logto:verified:123'};
const command={kind:'identity',id,logtoSubject:'usr_123'};
const makePool=(handler)=>{const calls=[];let released=0;return {calls,get released(){return released},async connect(){return {async query(q,p){calls.push([q,p]);return handler(q,p)},release(){released++}}}}};
test('creates new record with transaction and audit',async()=>{
 const pool=makePool((q)=> q.startsWith('SELECT command_kind')?{rows:[]}:{rows:[{id}],rowCount:1});
 assert.equal(await new CentralProvisioner(pool).apply(context,command),'created');
 assert.equal(pool.calls[0][0],'BEGIN');assert.equal(pool.calls[1][0],'SET LOCAL ROLE titan_trusted_writer');assert.equal(pool.calls.at(-1)[0],'COMMIT');assert.equal(pool.released,1);
 assert.equal(pool.calls.filter(([q])=>q.startsWith('INSERT')).length,2);
 assert.deepEqual(pool.calls.find(([q])=>q.startsWith('INSERT INTO titan.identities'))[1],[id,'usr_123']);
});
test('replays same request without new insert',async()=>{
 const pool=makePool(q=>q.startsWith('SELECT command_kind')?{rows:[{command_kind:'identity',command_digest:JSON.stringify({id,kind:'identity',logtoSubject:'usr_123'})}]}:{rows:[],rowCount:1});
 assert.equal(await new CentralProvisioner(pool).apply(context,command),'replayed');
 assert.equal(pool.calls.filter(([q])=>q.startsWith('INSERT')).length,0);
});
test('reused request id with changed payload fails and rolls back',async()=>{
 const pool=makePool(q=>q.startsWith('SELECT command_kind')?{rows:[{command_kind:'identity',command_digest:'different'}]}:{rows:[],rowCount:1});
 await assert.rejects(new CentralProvisioner(pool).apply(context,command),/reused/);
 assert.equal(pool.calls.at(-1)[0],'ROLLBACK');assert.equal(pool.released,1);
});
test('conflict fails without writing audit',async()=>{
 const pool=makePool(q=>q.startsWith('SELECT command_kind')?{rows:[]}:q.startsWith('INSERT INTO titan.identities')?{rowCount:0,rows:[]}:{rowCount:1,rows:[]});
 await assert.rejects(new CentralProvisioner(pool).apply(context,command),/conflict/);
 assert.equal(pool.calls.at(-1)[0],'ROLLBACK');assert.equal(pool.calls.some(([q])=>q.startsWith('INSERT INTO titan.provisioning_audit')),false);
});
test('rollback and release after database fault',async()=>{
 const pool=makePool(q=>{if(q.startsWith('INSERT INTO titan.identities'))throw Error('db down');return {rows:[],rowCount:1}});
 await assert.rejects(new CentralProvisioner(pool).apply(context,command),/db down/);
 assert.equal(pool.calls.at(-1)[0],'ROLLBACK');assert.equal(pool.released,1);
});
test('invalid commands never connect',async()=>{
 const pool={async connect(){throw Error('should not connect')}};
 const p=new CentralProvisioner(pool);
 await assert.rejects(p.apply({...context,requestId:'bad'},command),/invalid/);
 await assert.rejects(p.apply(context,{...command,id:'bad'}),/invalid/);
 await assert.rejects(p.apply(context,{kind:'membership',id,identityId:id,organisationId:id,role:'root'}),/invalid/);
 await assert.rejects(p.apply(context,{kind:'link',id,identityId:id,organisationId:id,applicationId:'field',localUserId:'a',localAccountId:'b',assertion:'not-a-jws'}),/invalid/);
 await assert.rejects(p.apply(context,{kind:'entitlement',id,organisationId:id,applicationId:'desk',features:['x','x']}),/invalid/);
});
test('valid membership, entitlement and link use bound SQL',async()=>{
 for(const c of [
  {kind:'membership',id,identityId:id,organisationId:id,role:'manager'},
  {kind:'entitlement',id,organisationId:id,applicationId:'academy',features:['courses:read']}
 ]){
  const pool=makePool(q=>q.startsWith('SELECT command_kind')?{rows:[]}:{rows:[{id}],rowCount:1});
  assert.equal(await new CentralProvisioner(pool).apply(context,c),'created');
  const insert=pool.calls.find(([q])=>q.startsWith('INSERT INTO titan.')&&!q.includes('provisioning_audit'));
  assert.ok(insert);assert.match(insert[0],/ON CONFLICT DO NOTHING RETURNING id/);
 }
});

// Update and revoke commands: expected-revision checks, audit, generation bumps in the same transaction.
const ORG='33333333-3333-4333-8333-333333333333', IDENT='44444444-4444-4444-8444-444444444444';
const reqId=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ctxN=(n)=>({requestId:reqId(n),actorSubject:'management:operator',authorityReference:'logto:verified:123'});
const isBump=q=>q.startsWith('INSERT INTO titan.titan_session_revocations');
function lifecyclePool({lock,members=[],updateRows=1,audit=[]}){
 const calls=[];let released=0;
 const handler=(q)=>{
  if(q.startsWith('SELECT command_kind'))return {rows:audit};
  if(q.includes('FOR UPDATE OF m'))return {rows:lock?[lock]:[]};
  if(q.includes('FOR UPDATE OF l'))return {rows:lock?[lock]:[]};
  if(q.includes('FROM titan.entitlements WHERE id'))return {rows:lock?[lock]:[]};
  if(q.startsWith('UPDATE titan.memberships')||q.startsWith('UPDATE titan.entitlements')||q.startsWith('UPDATE titan.local_account_links'))return {rowCount:updateRows,rows:[]};
  if(q.includes('WHERE m.organisation_id=$1'))return {rows:members};
  if(isBump(q))return {rows:[{generation:1}],rowCount:1};
  return {rows:[],rowCount:1};
 };
 return {calls,get released(){return released},async connect(){return {async query(q,p){calls.push([q,p]);return handler(q,p)},release(){released++}}}};
}
const idx=(calls,pred)=>calls.findIndex(([q])=>pred(q));
test('membership suspend locks, updates, bumps all apps, audits, then commits',async()=>{
 const pool=lifecyclePool({lock:{organisation_id:ORG,role:'manager',state:'active',revision:2,logto_subject:'usr_1'}});
 assert.equal(await new CentralProvisioner(pool).apply(ctxN(1),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:2,state:'suspended'}),'updated');
 const bumps=pool.calls.filter(([q])=>isBump(q)).map(([,p])=>p[0]);
 assert.deepEqual(bumps,['desk','field','academy']);
 const upd=idx(pool.calls,q=>q.startsWith('UPDATE titan.memberships')), audit=idx(pool.calls,q=>q.startsWith('INSERT INTO titan.provisioning_audit'));
 assert.ok(upd>0&&upd<idx(pool.calls,isBump)&&idx(pool.calls,isBump)<audit);
 assert.equal(pool.calls.at(-1)[0],'COMMIT');assert.equal(pool.released,1);
 assert.deepEqual(pool.calls.find(([q])=>isBump(q))[1],['desk','usr_1',ORG]);
});
test('demotion bumps generation, promotion without reduction does not',async()=>{
 const demote=lifecyclePool({lock:{organisation_id:ORG,role:'admin',state:'active',revision:1,logto_subject:'usr_1'}});
 await new CentralProvisioner(demote).apply(ctxN(2),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,role:'member'});
 assert.equal(demote.calls.filter(([q])=>isBump(q)).length,3);
 const promote=lifecyclePool({lock:{organisation_id:ORG,role:'member',state:'active',revision:1,logto_subject:'usr_1'}});
 assert.equal(await new CentralProvisioner(promote).apply(ctxN(3),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,role:'admin'}),'updated');
 assert.equal(promote.calls.filter(([q])=>isBump(q)).length,0);
});
test('membership revision conflict fails closed with no update, bump or audit',async()=>{
 const pool=lifecyclePool({lock:{organisation_id:ORG,role:'manager',state:'active',revision:3,logto_subject:'usr_1'}});
 await assert.rejects(new CentralProvisioner(pool).apply(ctxN(4),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:2,state:'revoked'}),/revision conflict/);
 assert.equal(pool.calls.some(([q])=>q.startsWith('UPDATE')||isBump(q)||q.startsWith('INSERT INTO titan.provisioning_audit')),false);
 assert.equal(pool.calls.at(-1)[0],'ROLLBACK');assert.equal(pool.released,1);
});
test('concurrent update losing the revision race rolls back the bump',async()=>{
 const pool=lifecyclePool({lock:{organisation_id:ORG,role:'manager',state:'active',revision:2,logto_subject:'usr_1'},updateRows:0});
 await assert.rejects(new CentralProvisioner(pool).apply(ctxN(5),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:2,state:'suspended'}),/revision conflict/);
 assert.equal(pool.calls.some(([q])=>isBump(q)),false);assert.equal(pool.calls.at(-1)[0],'ROLLBACK');
});
test('bump failure rolls back the row change and audit together',async()=>{
 const base=lifecyclePool({lock:{organisation_id:ORG,role:'manager',state:'active',revision:2,logto_subject:'usr_1'}});
 const pool={connect:async()=>{const c=await base.connect();return {query:async(q,p)=>{if(isBump(q))throw Error('db down');return c.query(q,p)},release(){c.release()}}}};
 await assert.rejects(new CentralProvisioner(pool).apply(ctxN(6),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:2,state:'suspended'}),/db down/);
 assert.equal(base.calls.some(([q])=>q.startsWith('INSERT INTO titan.provisioning_audit')),false);assert.equal(base.calls.at(-1)[0],'ROLLBACK');
});
test('entitlement revoke bumps every member of the organisation for that application',async()=>{
 const members=[{logto_subject:'usr_1',organisation_id:ORG},{logto_subject:'usr_2',organisation_id:ORG}];
 const pool=lifecyclePool({lock:{organisation_id:ORG,application_id:'academy',revision:1},members});
 assert.equal(await new CentralProvisioner(pool).apply(ctxN(7),{kind:'entitlement_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'revoked'}),'updated');
 const bumps=pool.calls.filter(([q])=>isBump(q)).map(([,p])=>p);
 assert.deepEqual(bumps,[['academy','usr_1',ORG],['academy','usr_2',ORG]]);
});
test('entitlement state change to active does not bump',async()=>{
 const pool=lifecyclePool({lock:{organisation_id:ORG,application_id:'academy',revision:1}});
 await new CentralProvisioner(pool).apply(ctxN(8),{kind:'entitlement_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'active'});
 assert.equal(pool.calls.filter(([q])=>isBump(q)).length,0);
});
test('entitlement revision conflict is rejected',async()=>{
 const pool=lifecyclePool({lock:{organisation_id:ORG,application_id:'academy',revision:4}});
 await assert.rejects(new CentralProvisioner(pool).apply(ctxN(9),{kind:'entitlement_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'paused'}),/revision conflict/);
});
test('link revoke bumps the one affected application and subject',async()=>{
 const pool=lifecyclePool({lock:{organisation_id:ORG,application_id:'field',state:'verified',revision:2,logto_subject:'usr_9'}});
 assert.equal(await new CentralProvisioner(pool).apply(ctxN(10),{kind:'link_revoke',id:IDENT,organisationId:ORG,expectedRevision:2}),'updated');
 assert.deepEqual(pool.calls.filter(([q])=>isBump(q)).map(([,p])=>p),[['field','usr_9',ORG]]);
});
test('link revoke on already revoked or stale link fails',async()=>{
 const revoked=lifecyclePool({lock:{organisation_id:ORG,application_id:'field',state:'revoked',revision:2,logto_subject:'usr_9'}});
 await assert.rejects(new CentralProvisioner(revoked).apply(ctxN(11),{kind:'link_revoke',id:IDENT,organisationId:ORG,expectedRevision:2}),/not verified/);
 const stale=lifecyclePool({lock:{organisation_id:ORG,application_id:'field',state:'verified',revision:5,logto_subject:'usr_9'}});
 await assert.rejects(new CentralProvisioner(stale).apply(ctxN(12),{kind:'link_revoke',id:IDENT,organisationId:ORG,expectedRevision:2}),/revision conflict/);
});
test('replaying an applied update returns replayed without touching rows',async()=>{
 const first=lifecyclePool({lock:{organisation_id:ORG,role:'manager',state:'active',revision:2,logto_subject:'usr_1'}});
 const cmd={kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:2,state:'suspended'};
 await new CentralProvisioner(first).apply(ctxN(13),cmd);
 const digest=first.calls.find(([q])=>q.startsWith('INSERT INTO titan.provisioning_audit'))[1][4];
 const replay=lifecyclePool({audit:[{command_kind:'membership_update',command_digest:digest}]});
 assert.equal(await new CentralProvisioner(replay).apply(ctxN(13),cmd),'replayed');
 assert.equal(replay.calls.filter(([q])=>q.startsWith('UPDATE')||isBump(q)).length,0);
});
test('invalid update and revoke commands never connect',async()=>{
 const pool={async connect(){throw Error('should not connect')}};const p=new CentralProvisioner(pool);
 await assert.rejects(p.apply(ctxN(14),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1}),/invalid/);
 await assert.rejects(p.apply(ctxN(14),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:0,state:'revoked'}),/invalid/);
 await assert.rejects(p.apply(ctxN(14),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,role:'root'}),/invalid/);
 await assert.rejects(p.apply(ctxN(14),{kind:'entitlement_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'bogus'}),/invalid/);
 await assert.rejects(p.apply(ctxN(14),{kind:'link_revoke',id:IDENT,organisationId:ORG,expectedRevision:-1}),/invalid/);
});
test('update command rejects a row that belongs to another organisation',async()=>{
 const pool=lifecyclePool({lock:{organisation_id:'55555555-5555-4555-8555-555555555555',role:'manager',state:'active',revision:1,logto_subject:'usr_1'}});
 await assert.rejects(new CentralProvisioner(pool).apply(ctxN(15),{kind:'membership_update',id:IDENT,organisationId:ORG,expectedRevision:1,state:'revoked'}),/organisation mismatch/);
 assert.equal(pool.calls.some(([q])=>q.startsWith('UPDATE')||isBump(q)),false);
});
