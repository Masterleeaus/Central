import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGrantChangeBody} from '../src/grant-change-boundary.mjs';
test('requires CAS revision only on transitions',()=>{
 assert.throws(()=>validateGrantChangeBody({clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},'transition'));
 assert.throws(()=>validateGrantChangeBody({...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},expectedRevision:1},'create'));
 assert.equal(validateGrantChangeBody({...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},expectedRevision:1},'transition').expectedRevision,1);
});
