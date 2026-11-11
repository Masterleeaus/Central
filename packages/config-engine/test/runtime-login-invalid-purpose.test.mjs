import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRuntimeLogin} from '../src/pg-runtime-login-check.mjs';
test('unknown database trust purpose denied before connecting',async()=>{
 let n=0;await assert.rejects(verifyRuntimeLogin({connect(){n++}},'admin'));assert.equal(n,0);
});
