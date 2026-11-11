import test from 'node:test';
import assert from 'node:assert/strict';
import {correlationId} from '../src/correlation.mjs';
test('correlation IDs reject control characters',()=>{
 assert.equal(correlationId(()=> 'trace-1'),'trace-1');
 assert.throws(()=>correlationId(()=> 'bad\ntrace'));
});
