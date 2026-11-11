import test from 'node:test';
import assert from 'node:assert/strict';
import {runScopedTransaction} from '../src/scoped-transaction.mjs';
test('transaction-local DB role and context, rollback on failure',async()=>{
 const q=[];let released=0;const pool={connect:async()=>({query:async(...args)=>{q.push(args);return{rows:[]}},release:()=>released++})};
 const id='550e8400-e29b-41d4-a716-446655440000';
 assert.equal(await runScopedTransaction(pool,{companyId:id,cohorts:['beta']},async()=>42),42);
 assert.ok(q.some(x=>x[0]==='SET LOCAL ROLE titan_config_reader'));assert.equal(q.at(-1)[0],'COMMIT');assert.equal(released,1);
 await assert.rejects(runScopedTransaction(pool,{companyId:id},async()=>{throw Error('oops')}));
 assert.equal(q.at(-1)[0],'ROLLBACK');assert.equal(released,2);
});
