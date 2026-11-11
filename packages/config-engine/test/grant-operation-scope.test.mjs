import test from 'node:test';
import assert from 'node:assert/strict';
import {grantOperationScope} from '../src/grant-operation-scope.mjs';
test('grant policies require canonical scope and valid operation',()=>{
 assert.deepEqual(grantOperationScope({...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},operation:'create'}),{companyId:'550e8400-e29b-41d4-a716-446655440000',product:'central',environment:'staging',operation:'create'});
 assert.throws(()=>grantOperationScope({...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},operation:'delete'}));
});
