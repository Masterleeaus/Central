import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGrantCommand} from '../src/grant-command.mjs';
test('refuses invalid expiry and deduplicates cohorts',()=>{
 const base={clientId:'machine',product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000',cohorts:[],state:'active',actor:'operator'};
 assert.deepEqual(validateGrantCommand({...base,cohorts:['early','early']}).cohorts,['early']);
 assert.throws(()=>validateGrantCommand({...base,expiresAt:'not-a-date'}));
 assert.equal(validateGrantCommand({...base,expiresAt:'2027-01-01T00:00:00Z'}).expiresAt,'2027-01-01T00:00:00.000Z');
});
