import test from 'node:test';
import assert from 'node:assert/strict';
import {jwtParts} from '../src/jwt-parts.mjs';
test('decode signed components without accepting bad JSON',()=>{
 const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 assert.equal(jwtParts(b({alg:'RS256'})+'.'+b({sub:'svc'})+'.sig').claims.sub,'svc');
 assert.throws(()=>jwtParts('bad.bad.sig'));
});
