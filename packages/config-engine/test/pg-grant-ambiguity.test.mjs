import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgGrantRegistry} from '../src/pg-grant-registry.mjs';
test('zero or multiple active companies fail closed',async()=>{
 for(const count of [0,2]){
  const statements=[];
  const c={query:async(q)=>{statements.push(q);return q.includes('FROM titan_config.service_company_grants')?{rows:Array(count).fill({product:'central',environment:'stage',company_id:'550e8400-e29b-41d4-a716-446655440000',cohorts:[]})}:{rows:[]}},release(){}};
  await assert.rejects(createPgGrantRegistry({pool:{connect:async()=>c}})({clientId:'svc',application:'central',environment:'stage'}));
  assert.equal(statements.at(-1),'ROLLBACK');
 }
});
