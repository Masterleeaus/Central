import test from 'node:test';
import assert from 'node:assert/strict';
import {publicDecision} from '../src/public-decision.mjs';
test('decision omits sensitive attributes',()=>{const d=publicDecision({key:'flag',value:false,revision:0,source:'default',actor:'private',company:'private'});assert.deepEqual(d,{key:'flag',value:false,revision:0,source:'default'});});
