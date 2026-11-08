/** Transaction wrapping with a fake client: the role switch, rollback on error, and whether a
 * connection is reused or destroyed on release. No database is used. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withRoleTransaction,DATABASE_ROLES} from '../src/role-transaction.mjs';
import {createPostgresSessionRevocations} from '../src/session-revocation-pg.mjs';
/** failOn: map of statement prefix -> error to throw instead of answering. */
function fakePool({failOn={},rows=[]}={}){
  const conns=[];
  return {conns,connect:async()=>{
    const c={log:[],released:undefined,released_called:false,
      query:async(q,v)=>{c.log.push(q);for(const [prefix,err] of Object.entries(failOn)){if(q.startsWith(prefix)){if(err.once){delete failOn[prefix];}throw err.error??err;}}return /^(BEGIN|COMMIT|ROLLBACK|SET LOCAL ROLE)/.test(q)?{rows:[],rowCount:0}:{rows,rowCount:rows.length};},
      release(err){c.released_called=true;c.released=err;}};
    conns.push(c);return c;
  }};
}
test('exposes only the two trusted roles',()=>{assert.deepEqual([...DATABASE_ROLES],['titan_trusted_reader','titan_trusted_writer']);});
test('rejects a role outside the allowlist without touching the pool',async()=>{const pool=fakePool();await assert.rejects(withRoleTransaction(pool,'postgres',async()=>1),/invalid database role/);await assert.rejects(withRoleTransaction(pool,'titan_tenant_app; DROP',async()=>1),/invalid database role/);assert.equal(pool.conns.length,0);});
test('rejects a pool without connect()',async()=>{await assert.rejects(withRoleTransaction({query:async()=>({rows:[]})},'titan_trusted_reader',async()=>1),/connect\(\)/);});
test('runs BEGIN, SET LOCAL ROLE, task, COMMIT and releases the connection clean',async()=>{const pool=fakePool();const out=await withRoleTransaction(pool,'titan_trusted_reader',async c=>{c.log.push('task');return 'value'});assert.equal(out,'value');const [c]=pool.conns;assert.deepEqual(c.log,['BEGIN','SET LOCAL ROLE titan_trusted_reader','task','COMMIT']);assert.equal(c.released_called,true);assert.equal(c.released,undefined);});
test('an error in the task rolls back and the connection is still reused',async()=>{const pool=fakePool();await assert.rejects(withRoleTransaction(pool,'titan_trusted_writer',async()=>{throw new Error('boom')}),/boom/);const [c]=pool.conns;assert.deepEqual(c.log,['BEGIN','SET LOCAL ROLE titan_trusted_writer','ROLLBACK']);assert.equal(c.released,undefined);});
test('a failed COMMIT is rolled back and the connection is reused',async()=>{const pool=fakePool({failOn:{COMMIT:{error:new Error('commit failed'),once:true}}});await assert.rejects(withRoleTransaction(pool,'titan_trusted_writer',async()=>1),/commit failed/);const [c]=pool.conns;assert.deepEqual(c.log,['BEGIN','SET LOCAL ROLE titan_trusted_writer','COMMIT','ROLLBACK']);assert.equal(c.released,undefined);});
test('a failed ROLLBACK destroys the connection instead of returning it to the pool',async()=>{const pool=fakePool({failOn:{ROLLBACK:{error:new Error('connection lost')}}});await assert.rejects(withRoleTransaction(pool,'titan_trusted_reader',async()=>{throw new Error('task failed')}),/task failed/);const [c]=pool.conns;assert.ok(c.released instanceof Error);});
test('a failed BEGIN destroys the connection because its state is unknown',async()=>{const pool=fakePool({failOn:{BEGIN:{error:new Error('no BEGIN')}}});await assert.rejects(withRoleTransaction(pool,'titan_trusted_reader',async()=>1),/no BEGIN/);const [c]=pool.conns;assert.ok(c.released instanceof Error);assert.deepEqual(c.log,['BEGIN']);});
test('a failed SET LOCAL ROLE rolls back and reuses the connection, so no role is left set',async()=>{const pool=fakePool({failOn:{'SET LOCAL ROLE':{error:new Error('permission denied to set role')}}});await assert.rejects(withRoleTransaction(pool,'titan_trusted_writer',async()=>1),/permission denied to set role/);const [c]=pool.conns;assert.deepEqual(c.log,['BEGIN','SET LOCAL ROLE titan_trusted_writer','ROLLBACK']);assert.equal(c.released,undefined);});
test('readVersion runs its SELECT as titan_trusted_reader',async()=>{const pool=fakePool({rows:[{generation:'3'}]});assert.equal(await createPostgresSessionRevocations({pool}).readVersion({applicationId:'desk',logtoSubject:'sub1',organisationId:'org1'}),3);const [c]=pool.conns;assert.equal(c.log[0],'BEGIN');assert.equal(c.log[1],'SET LOCAL ROLE titan_trusted_reader');assert.match(c.log[2],/^SELECT generation FROM titan\.titan_session_revocations/);assert.equal(c.log[3],'COMMIT');assert.equal(c.released,undefined);});
test('revokeAll runs its upsert as titan_trusted_writer',async()=>{const pool=fakePool({rows:[{generation:'2'}]});assert.equal(await createPostgresSessionRevocations({pool}).revokeAll({applicationId:'field',logtoSubject:'sub1',organisationId:'org1'}),2);const [c]=pool.conns;assert.equal(c.log[1],'SET LOCAL ROLE titan_trusted_writer');assert.match(c.log[2],/ON CONFLICT/);assert.equal(c.log[3],'COMMIT');});
test('a failed revocation bump surfaces the error and rolls back',async()=>{const pool=fakePool({failOn:{'INSERT INTO titan.titan_session_revocations':{error:new Error('permission denied for table titan_session_revocations')}}});await assert.rejects(createPostgresSessionRevocations({pool}).revokeAll({applicationId:'desk',logtoSubject:'sub1',organisationId:'org1'}),/permission denied/);assert.equal(pool.conns[0].log.at(-1),'ROLLBACK');});
