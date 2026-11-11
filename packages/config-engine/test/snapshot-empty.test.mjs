import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgConfigStore} from '../src/pg-store.mjs';
test('unknown definition results in empty snapshot',async()=>{
 const client={query:async()=>({rows:[]}),release(){}};
 const store=createPgConfigStore({pool:{connect:async()=>client}});
 const r=await store.readSnapshot({key:'unknown',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000'});
 assert.deepEqual(r,{definition:null,overrides:[]});
});
