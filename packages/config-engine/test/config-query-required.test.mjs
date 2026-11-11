import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfigQuery} from '../src/config-request-schema.mjs';
test('a missing application cannot select a fallback tenant',()=>{
 assert.throws(()=>validateConfigQuery({key:'feature',environment:'stage'}));
 assert.throws(()=>validateConfigQuery({key:'feature',application:'central'}));
});
