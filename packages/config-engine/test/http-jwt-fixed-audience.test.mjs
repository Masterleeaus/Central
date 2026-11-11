import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceBearer} from '../scripts/http-server-harness.mjs';
test('service tokens use a dedicated configuration audience',()=>{
 const p=JSON.parse(Buffer.from(serviceBearer('svc_a').split(' ')[1].split('.')[1],'base64url'));
 assert.equal(p.aud,'https://api.integration.test/config');
});
