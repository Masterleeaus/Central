import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorisedGrantWriter} from '../src/authorised-grant-writer.mjs';
test('requires both fresh operator authority and company scope before write',async()=>{
 let mutations=0,roles=0,companies=0;
 const service=createAuthorisedGrantWriter({writer:{create:async x=>{mutations++;return x},transition:async x=>{mutations++;return x}},
 authoriseOperator:async()=>{roles++;return true},authorizeCompany:async()=>{companies++;return true}});
 const p={logtoSubject:'operator_1',operatorAuthorityVerified:true};
 const result=await service.create(p,{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]});
 assert.equal(result.actor,'operator_1');assert.equal(mutations,1);assert.equal(roles,1);assert.equal(companies,1);
});
