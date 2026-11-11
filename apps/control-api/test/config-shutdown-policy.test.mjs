import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyShutdown} from '../src/config-shutdown-policy.mjs';
test('summary contains counts only, never raw driver exceptions',()=>{
 const s=classifyShutdown([{status:'fulfilled'},{status:'rejected',reason:Error('private-url')}]);
 assert.deepEqual(s,{complete:false,failures:1});assert.ok(!JSON.stringify(s).includes('private-url'));
});
