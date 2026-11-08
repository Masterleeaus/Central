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
 assert.equal(pool.calls[0][0],'BEGIN');assert.equal(pool.calls.at(-1)[0],'COMMIT');assert.equal(pool.released,1);
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
 await assert.rejects(p.apply(context,{kind:'link',id,identityId:id,organisationId:id,applicationId:'sorted',localUserId:'a',localAccountId:'b',verifiedAt:'junk'}),/invalid/);
 await assert.rejects(p.apply(context,{kind:'entitlement',id,organisationId:id,applicationId:'supercharged',features:['x','x']}),/invalid/);
});
test('valid membership, entitlement and link use bound SQL',async()=>{
 for(const c of [
  {kind:'membership',id,identityId:id,organisationId:id,role:'manager'},
  {kind:'entitlement',id,organisationId:id,applicationId:'lms',features:['courses:read']},
  {kind:'link',id,identityId:id,organisationId:id,applicationId:'sorted',localUserId:'u',localAccountId:'a',verifiedAt:'2026-11-02T00:00:00.000Z'}
 ]){
  const pool=makePool(q=>q.startsWith('SELECT command_kind')?{rows:[]}:{rows:[{id}],rowCount:1});
  assert.equal(await new CentralProvisioner(pool).apply(context,c),'created');
  const insert=pool.calls.find(([q])=>q.startsWith('INSERT INTO titan.')&&!q.includes('provisioning_audit'));
  assert.ok(insert);assert.match(insert[0],/ON CONFLICT DO NOTHING RETURNING id/);
 }
});
