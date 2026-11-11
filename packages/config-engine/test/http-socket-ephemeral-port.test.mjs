import test from 'node:test';
import assert from 'node:assert/strict';
import {freePort} from '../scripts/http-server-harness.mjs';
test('loopback socket port is valid',async()=>{
 const p=await freePort();assert.ok(p>0&&p<=65535);
});
