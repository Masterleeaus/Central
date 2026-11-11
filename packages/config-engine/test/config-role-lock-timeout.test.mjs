import test from 'node:test';
import assert from 'node:assert/strict';
import {runScopedTransaction} from '../src/scoped-transaction.mjs';
test('restricted database read sets bounded lock timeout',async()=>{
 const sql=[];const pool={connect:async()=>({query:async q=>{sql.push(q);return{rows:[]}},release(){}})};
 await runScopedTransaction(pool,{companyId:'550e8400-e29b-41d4-a716-446655440000'},async()=>42);
 assert.ok(sql.includes("SET LOCAL lock_timeout = '2000ms'"));
});
