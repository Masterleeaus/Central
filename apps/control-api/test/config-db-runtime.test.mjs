import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigDbRuntime} from '../src/config-db-runtime.mjs';
test('off means no extra database pools created',()=>{
 let created=0;
 assert.equal(createConfigDbRuntime({env:{},Pool:class{constructor(){created++}}}),null);
 assert.equal(created,0);
});
