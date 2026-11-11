import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalGrantService} from '../src/canonical-grant-service.mjs';
test('factory requires independently configured operator authority',()=>{
 assert.throws(()=>createCanonicalGrantService({authorityPool:{connect(){}},writerPool:{connect(){}}}));
});
