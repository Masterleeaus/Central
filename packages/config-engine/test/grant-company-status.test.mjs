import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgGrantRegistry} from '../src/pg-grant-registry.mjs';
test('active service grant does not override suspended company status',async()=>{
 const c={query:async sql=>sql.includes('FROM titan_config.service_company_grants')?
 {rows:[{product:'central',environment:'stage',company_id:'550e8400-e29b-41d4-a716-446655440001',cohorts:[],state:'active',company_status:'suspended'}]}:{rows:[]},release(){}};
 await assert.rejects(createPgGrantRegistry({pool:{connect:async()=>c}})({clientId:'svc',application:'central',environment:'stage'}));
});
