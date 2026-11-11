import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedGrantMutationResult} from '../src/grant-result-contract.mjs';
test('mutation output requires a durable grant ID and revision',()=>{
 assert.deepEqual(verifiedGrantMutationResult({id:'7',revision:1}),{id:'7',revision:1});
 assert.throws(()=>verifiedGrantMutationResult({id:'',revision:1}));
 assert.throws(()=>verifiedGrantMutationResult({id:'7',revision:0}));
});
