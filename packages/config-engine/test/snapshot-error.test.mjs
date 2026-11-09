import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgConfigStore} from '../src/pg-store.mjs';
test('snapshot failure rolls back and releases connection',async()=>{
 const sql=[];let released=false;
 const client={query:async q=>{sql.push(q);if(q.includes('FROM titan_config.definitions'))throw Error('offline');return{rows:[]};},release:()=>released=true};
 const store=createPgConfigStore({pool:{connect:async()=>client}});
 await assert.rejects(store.readSnapshot({key:'flag',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000'}));
 assert.equal(sql.at(-1),'ROLLBACK');assert.equal(released,true);
});
