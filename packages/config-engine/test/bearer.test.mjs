import test from 'node:test';
import assert from 'node:assert/strict';
import {readBearer} from '../src/bearer.mjs';
test('strict bearer grammar',()=>{assert.throws(()=>readBearer('Basic credentials'));assert.throws(()=>readBearer('Bearer a b'));assert.throws(()=>readBearer('Bearer a.b'));assert.equal(readBearer('Bearer '+['a'.repeat(12),'b'.repeat(12),'c'.repeat(12)].join('.')).split('.').length,3)});
