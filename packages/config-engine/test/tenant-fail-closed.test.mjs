import test from 'node:test';
import assert from 'node:assert/strict';
import {readTenantFlag} from '../src/read-model.mjs';
const a='550e8400-e29b-41d4-a716-446655440000',b='550e8400-e29b-41d4-a716-446655440001';
test('wrong company override is ignored even if returned by storage',async()=>{
 const store={readSnapshot:async()=>({definition:{key:'flag',owner:'ops',product:'central',type:'boolean',defaultValue:false},overrides:[{product:'central',environment:'staging',target:{companyId:b},value:true,percentage:100,revision:1,expiresAt:null}]})};
 const d=await readTenantFlag({store,key:'flag',context:{product:'central',environment:'staging',companyId:a},salt:'test-salt'});
 assert.deepEqual(d,{key:'flag',value:false,revision:0,source:'default'});
});
