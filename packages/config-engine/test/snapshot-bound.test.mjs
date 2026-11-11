import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSnapshot} from '../src/snapshot-policy.mjs';
test('oversized snapshot rejected',()=>{assert.throws(()=>assertSnapshot({definition:{},overrides:Array(10001).fill({})}));assert.throws(()=>assertSnapshot({overrides:[]}));});
