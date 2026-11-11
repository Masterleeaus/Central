import test from 'node:test';
import assert from 'node:assert/strict';
import {listenCentral} from '../src/service-startup-listener.mjs';
test('invalid port fails before opening listener',async()=>{
 let count=0;const s={listen(){count++}};
 await assert.rejects(listenCentral(s,0));
 assert.equal(count,0);
});
