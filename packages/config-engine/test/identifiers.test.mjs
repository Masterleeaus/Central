import test from 'node:test';
import assert from 'node:assert/strict';
import {identifier,companyId,product,environment} from '../src/identifiers.mjs';
test('rejects unsafe keys and app spoofing',()=>{assert.throws(()=>identifier('__proto__!'));assert.throws(()=>product('field'));assert.equal(environment('staging'),'staging');});
test('requires canonical company UUID',()=>{assert.throws(()=>companyId('not-a-uuid'));assert.equal(companyId('550E8400-E29B-41D4-A716-446655440000'),'550e8400-e29b-41d4-a716-446655440000');});
