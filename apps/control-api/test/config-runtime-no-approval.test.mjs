import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyConfigRuntimeReadiness} from '../src/config-runtime-readiness.mjs';
test('unapproved migration prevents any SQL checks',async()=>{
 let called=0;const p={connect(){called++}};
 await assert.rejects(verifyConfigRuntimeReadiness({runtime:{configPool:p,grantPool:{connect(){called++}}},env:{}}));
 assert.equal(called,0);
});
