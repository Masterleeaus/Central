import test from 'node:test';
import assert from 'node:assert/strict';
import {readTenantFlag} from '../src/read-model.mjs';
test('passes scoped tenant, cohorts and product to snapshot',async()=>{
 let args;const companyId='550e8400-e29b-41d4-a716-446655440000';
 const store={readSnapshot:async x=>{args=x;return{definition:{key:'flag',owner:'ops',product:'central',type:'boolean',defaultValue:false},overrides:[]};}};
 const result=await readTenantFlag({store,key:'flag',context:{product:'central',environment:'staging',companyId,cohorts:['beta']},salt:'test-salt'});
 assert.deepEqual(args,{key:'flag',product:'central',environment:'staging',companyId,cohorts:['beta']});
 assert.equal(result.value,false);
});
