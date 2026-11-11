import test from 'node:test';import assert from 'node:assert/strict';
import {readServiceDecisionConfig} from '../src/service-decision-config.mjs';
import {issuer,token} from './service-decision-harness.mjs';
test('disabled service decision endpoint without explicit secret',()=>assert.equal(readServiceDecisionConfig({}),null));
test('valid operator issuer, credential and audience',()=>assert.deepEqual(readServiceDecisionConfig({
 TITAN_SKILLED_DECISION_BEARER:token,TITAN_OIDC_ISSUER:issuer,TITAN_ACADEMY_AUDIENCE:'academy-client'
}),{token,issuer,audience:'academy-client'}));
for(const wrong of ['short','http://id.example.test','https://user:pass@id.example.test'])test('invalid issuer/secret rejects without fallback: '+wrong,()=>{
 assert.throws(()=>readServiceDecisionConfig({TITAN_SKILLED_DECISION_BEARER:wrong==='short'?'short':token,
 TITAN_OIDC_ISSUER:wrong==='short'?issuer:wrong,TITAN_ACADEMY_AUDIENCE:'academy-client'}));
});