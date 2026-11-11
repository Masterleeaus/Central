import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrantMutationService} from '../src/grant-mutation-service.mjs';
test('service ignores caller-supplied actor and applies verified operator',async()=>{
 let saved;const service=createGrantMutationService({writer:{create:async x=>(saved=x,x),transition:async x=>x},
 authoriseOperator:async()=>true,authorizeCompany:async()=>true});
 const principal={logtoSubject:'operator_1',operatorAuthorityVerified:true};
 await service.create({principal,command:{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]}});
 assert.equal(saved.actor,'operator_1');
 await assert.rejects(service.create({principal,command:{...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},actor:'attacker'}}));
});
