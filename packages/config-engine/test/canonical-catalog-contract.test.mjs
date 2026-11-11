import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCanonicalSchema} from '../src/pg-canonical-catalog.mjs';
test('incomplete catalog denies startup',async()=>{
 await assert.rejects(verifyCanonicalSchema({query:async()=>({rows:[]})}));
});
