import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceBearer} from '../scripts/http-server-harness.mjs';
test('independent machine tokens cannot be treated as the same client',()=>{
 const a=serviceBearer('svc_a'),b=serviceBearer('svc_c');assert.notEqual(a.split('.')[1],b.split('.')[1]);
});
