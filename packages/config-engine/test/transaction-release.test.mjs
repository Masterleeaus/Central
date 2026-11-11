import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgConfigStore} from '../src/pg-store.mjs';
test('connection release occurs after successful snapshot',async()=>{
 let releases=0;const client={query:async()=>({rows:[]}),release:()=>releases++};
 const store=createPgConfigStore({pool:{connect:async()=>client}});
 await store.readSnapshot({key:'unknown',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000'});
 assert.equal(releases,1);
});
