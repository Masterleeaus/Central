import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrantPolicyGuard} from '../src/grant-policy-guard.mjs';
test('inactive companies fail before operator entitlement query',async()=>{
 let called=0;const guard=createGrantPolicyGuard({isCompanyActive:async()=>false,isOperatorEntitled:async()=>{called++;return true}});
 assert.equal(await guard({...{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]},operation:'create',operatorSubject:'operator_1'}),false);
 assert.equal(called,0);
});
