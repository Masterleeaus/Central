import test from 'node:test';import assert from 'node:assert/strict';
import {parseServiceDecisionRequest} from '../src/service-decision-request.mjs';
import {issuer,valid} from './service-decision-harness.mjs';
test('exact validated input with organisation chosen server-side',()=>assert.deepEqual(parseServiceDecisionRequest(valid,issuer),valid));
for(const [field,value] of [['applicationId','field'],['issuer','https://evil.test'],['organisationId','forged'],['requestId','x'],['subject','']])
 test('invalid '+field+' denied',()=>assert.equal(parseServiceDecisionRequest({...valid,[field]:value},issuer),null));
for(const key of ['email','role','companyId','decision','action'])test('unexpected '+key+' denied',
 ()=>assert.equal(parseServiceDecisionRequest({...valid,[key]:'forged'},issuer),null));
test('arrays and null denied',()=>{assert.equal(parseServiceDecisionRequest([],issuer),null);assert.equal(parseServiceDecisionRequest(null,issuer),null)});