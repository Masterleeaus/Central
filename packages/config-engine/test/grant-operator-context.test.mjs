import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedGrantOperator} from '../src/grant-operator-context.mjs';
test('requires fresh operator authority and trusted subject',async()=>{
 const p={logtoSubject:'operator_1',operatorAuthorityVerified:true};
 assert.equal((await verifiedGrantOperator({principal:p,authoriseOperator:async()=>true})).subject,'operator_1');
 await assert.rejects(verifiedGrantOperator({principal:p,authoriseOperator:async()=>false}));
 await assert.rejects(verifiedGrantOperator({principal:{logtoSubject:'operator_1'},authoriseOperator:async()=>true}));
});
