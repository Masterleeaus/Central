import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCanonicalDbAtStartup} from '../src/pg-canonical-startup.mjs';
test('cannot verify schema without database connection',async()=>{
 await assert.rejects(verifyCanonicalDbAtStartup(null));
});
