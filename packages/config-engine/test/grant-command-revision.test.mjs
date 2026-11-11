import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGrantTransition} from '../src/grant-command.mjs';
test('rejects missing or invalid expected revision',()=>{
 const base={clientId:'machine',product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000',cohorts:[],state:'active',actor:'operator'};
 assert.throws(()=>validateGrantTransition(base));
 assert.throws(()=>validateGrantTransition({...base,expectedRevision:0}));
 assert.equal(validateGrantTransition({...base,expectedRevision:2}).expectedRevision,2);
});
