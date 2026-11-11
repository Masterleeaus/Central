import test from 'node:test';
import assert from 'node:assert/strict';
import {auditActorFromPrincipal} from '../src/grant-audit-identity.mjs';
test('audit actor is drawn exclusively from verified operator principal',()=>{
 assert.equal(auditActorFromPrincipal({operatorAuthorityVerified:true,logtoSubject:'operator_1'}),'operator_1');
 assert.throws(()=>auditActorFromPrincipal({logtoSubject:'operator_1'}));
 assert.throws(()=>auditActorFromPrincipal({operatorAuthorityVerified:true,logtoSubject:'not safe'}));
});
