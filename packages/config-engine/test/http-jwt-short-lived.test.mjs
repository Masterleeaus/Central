import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceBearer} from '../scripts/http-server-harness.mjs';
test('signed machine token expires quickly',()=>{
 const p=JSON.parse(Buffer.from(serviceBearer('svc_a').split(' ')[1].split('.')[1],'base64url'));
 assert.equal(p.client_id,'svc_a');assert.ok(p.exp-p.iat<=180);
});
