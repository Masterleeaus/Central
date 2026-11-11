import test from 'node:test';
import assert from 'node:assert/strict';
import {readTenantFlag} from '../src/read-model.mjs';
const a='550e8400-e29b-41d4-a716-446655440000',b='550e8400-e29b-41d4-a716-446655440001';
test('foreign override never changes decision',async()=>{
 let calls=0;const store={readSnapshot:async()=>{calls++;return {definition:{key:'flag',owner:'ops',product:'central',type:'boolean',defaultValue:false},overrides:[{product:'central',environment:'stage',target:{companyId:b},value:true,revision:1,percentage:100,expiresAt:null}]}}};
 const v=await readTenantFlag({store,key:'flag',context:{product:'central',environment:'stage',companyId:a},salt:'secret'});
 assert.equal(v.value,false);assert.equal(calls,1);
});
