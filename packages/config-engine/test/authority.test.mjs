import test from 'node:test';
import assert from 'node:assert/strict';
import {requireConfigAuthority} from '../src/authority.mjs';
test('strict scoped grants only',()=>{const actor={id:'operator',permissions:['config:write:central:staging']};assert.equal(requireConfigAuthority({actor,action:'write',product:'central',environment:'staging'}).actorId,'operator');assert.throws(()=>requireConfigAuthority({actor,action:'write',product:'central',environment:'production'}));assert.throws(()=>requireConfigAuthority({actor:{id:'x',permissions:['config:write:central:*']},action:'write',product:'central',environment:'staging'}));});
