import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorisedGrantWriter} from '../src/authorised-grant-writer.mjs';
test('every transition rechecks operator and canonical company',async()=>{
 let checks=0;const p={logtoSubject:'operator_1',operatorAuthorityVerified:true};
 const service=createAuthorisedGrantWriter({writer:{create:async()=>({}),transition:async x=>x},
 authoriseOperator:async()=>{checks++;return true},authorizeCompany:async()=>true});
 await service.transition(p,{...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},expectedRevision:2,state:'revoked'});
 await service.transition(p,{...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},expectedRevision:3,state:'suspended'});
 assert.equal(checks,2);
});
