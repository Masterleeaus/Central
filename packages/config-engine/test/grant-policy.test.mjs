import test from 'node:test';
import assert from 'node:assert/strict';
import {grantRevision,grantStateAllowed} from '../src/grant-policy.mjs';
test('revision and expiry policies fail closed',()=>{
 assert.equal(grantRevision({expected:1,next:2}),2);
 assert.throws(()=>grantRevision({expected:1,next:1}));
 assert.equal(grantStateAllowed('revoked',null),false);
 assert.equal(grantStateAllowed('active','2020-01-01T00:00:00Z',Date.now()),false);
 assert.equal(grantStateAllowed('active',null),true);
});
