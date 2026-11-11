import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceBearer} from '../scripts/http-server-harness.mjs';
test('machine JWTs are not the separate field operator audience',()=>{
 const p=JSON.parse(Buffer.from(serviceBearer('svc_a').split(' ')[1].split('.')[1],'base64url'));
 assert.notEqual(p.aud,'field-ci');
});
