import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGrantCommand} from '../src/grant-command.mjs';
test('validates machine identity, canonical company and actor',()=>{
 const cmd=validateGrantCommand({clientId:'machine',product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000',cohorts:[],state:'active',actor:'operator'});
 assert.equal(cmd.clientId,'machine');assert.equal(cmd.cohorts.length,0);
 for(const field of ['clientId','actor','companyId'])assert.throws(()=>validateGrantCommand({...cmd,[field]:'invalid value'}));
});
