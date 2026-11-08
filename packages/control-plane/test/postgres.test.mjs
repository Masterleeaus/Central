import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresCentralRepository, withCentralReadSnapshot } from '../dist/postgres.js';

test('repository uses bound arguments and maps identity', async()=> {
 const seen=[]; const repo=new PostgresCentralRepository({async query(q,params){seen.push([q,params]);return {rows:[{id:'i',logto_subject:'user-a',state:'active'}]}}});
 assert.deepEqual(await repo.identityBySubject("x' OR 1=1--"),{id:'i',logtoSubject:'user-a',status:'active'});
 assert.deepEqual(seen[0][1],["x' OR 1=1--"]);assert.match(seen[0][0],/logto_subject=\$1/);
});
test('repository returns empty arrays',async()=>{const r=new PostgresCentralRepository({async query(){return {rows:[]}}});assert.deepEqual(await r.memberships('u','o'),[]);assert.deepEqual(await r.entitlements('o','desk'),[]);assert.deepEqual(await r.localLinks('u','o','field'),[]);});
test('repository maps expiry and revisions',async()=>{const r=new PostgresCentralRepository({async query(){return {rows:[{id:'x',identity_id:'i',organisation_id:'o',role:'admin',state:'active',revision:'3',expires_at:new Date('2030-01-01T00:00:00Z')} ]}}});assert.equal((await r.memberships('i','o'))[0].revision,3);});
const ORG='00000000-0000-4000-8000-00000000000a';
const makeSnapshotPool=({failOn}={})=>{const calls=[];let released=0;let connects=0;return {calls,get released(){return released},get connects(){return connects},async connect(){connects++;return {async query(q,p){calls.push([q,p]);if(failOn&&failOn(q))throw Error('boom');return {rows:[]}},release(){released++}}}}};
test('snapshot sets role and tenant scope before any read, then commits and releases',async()=>{
 const pool=makeSnapshotPool();
 const result=await withCentralReadSnapshot(pool,ORG,async r=>{await r.memberships('i',ORG);return 3});
 assert.equal(result,3);
 const q=pool.calls.map(([s])=>s);
 assert.deepEqual(q.slice(0,4),['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY','SET LOCAL ROLE titan_trusted_reader',"SELECT set_config('titan.organisation_id', $1, true)","SET LOCAL statement_timeout = '5000ms'"]);
 assert.match(q[4],/^SELECT id, identity_id/);
 assert.equal(q.at(-1),'COMMIT');assert.equal(pool.released,1);
});
test('snapshot binds the organisation as a parameter, never in the SQL text',async()=>{
 const pool=makeSnapshotPool();
 await withCentralReadSnapshot(pool,ORG,async r=>r.entitlements(ORG,'desk'));
 const scope=pool.calls.find(([s])=>s.startsWith('SELECT set_config'));
 assert.deepEqual(scope[1],[ORG]);
 assert.equal(scope[0].includes(ORG),false);
});
test('snapshot refuses a non-UUID organisation before connecting',async()=>{
 for (const bad of ["x' OR 1=1--", '', undefined, 42]) {
  const pool=makeSnapshotPool();
  await assert.rejects(withCentralReadSnapshot(pool,bad,async()=>1),/organisation scope required/);
  assert.equal(pool.connects,0);
 }
});
test('snapshot rolls back when the tenant scope cannot be set',async()=>{
 const pool=makeSnapshotPool({failOn:q=>q.startsWith('SELECT set_config')});
 let ran=false;
 await assert.rejects(withCentralReadSnapshot(pool,ORG,async()=>{ran=true;return 1}),/boom/);
 assert.equal(ran,false);
 assert.equal(pool.calls.at(-1)[0],'ROLLBACK');assert.equal(pool.released,1);
});
test('snapshot rolls back on query failure',async()=>{
 const pool=makeSnapshotPool({failOn:q=>q.startsWith('SELECT id, logto_subject')});
 await assert.rejects(withCentralReadSnapshot(pool,ORG,r=>r.identityBySubject('bad')),/boom/);
 assert.equal(pool.calls.at(-1)[0],'ROLLBACK');assert.equal(pool.released,1);
});
