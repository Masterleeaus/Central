import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSnapshot} from '../src/snapshot-policy.mjs';
test('snapshot requires definition and bounded override list',()=>{
 assert.throws(()=>assertSnapshot({overrides:[]}));
 assert.throws(()=>assertSnapshot({definition:{},overrides:null}));
 assert.deepEqual(assertSnapshot({definition:{},overrides:[]}),{definition:{},overrides:[]});
});
