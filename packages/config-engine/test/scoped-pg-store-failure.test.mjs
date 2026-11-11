import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopedPgConfigStore} from '../src/scoped-pg-store.mjs';
test('errors roll back and release role-scoped connection',async()=>{
 const sql=[];let released=0;
 const c={query:async q=>{sql.push(q);if(q.includes('FROM titan_config.definitions'))throw Error('query failed');return {rows:[]}},release:()=>released++};
 const store=createScopedPgConfigStore({pool:{connect:async()=>c}});
 await assert.rejects(store.readSnapshot({key:'feature',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000'}));
 assert.equal(sql.at(-1),'ROLLBACK');assert.equal(released,1);
});
