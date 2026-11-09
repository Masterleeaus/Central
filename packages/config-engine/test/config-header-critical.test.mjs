import test from 'node:test';
import assert from 'node:assert/strict';
import {jwtParts} from '../src/jwt-parts.mjs';
test('untrusted JWT header is parse-only before verification',()=>{
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 assert.equal(jwtParts(encode({crit:['foo']})+'.'+encode({sub:'svc'})+'.signature').header.crit[0],'foo');
});
