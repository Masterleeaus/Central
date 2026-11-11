import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGrantChangeBody} from '../src/grant-change-boundary.mjs';
test('rejects principal escalation fields in grant command',()=>{
 assert.equal(validateGrantChangeBody({clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},'create').clientId,'service_1');
 for(const field of ['actor','operatorAuthorityVerified','role','sql','principal']){
 assert.throws(()=>validateGrantChangeBody({...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},[field]:true},'create'));
 }
});
