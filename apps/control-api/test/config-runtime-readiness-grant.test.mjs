import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyConfigRuntimeReadiness} from '../src/config-runtime-readiness.mjs';
const a={connect(){}},b={connect(){}},runtime={configPool:a,grantPool:b},env={TITAN_CONFIG_MIGRATION_APPROVED:'true',TITAN_CONFIG_CANONICAL_MIGRATION_ID:'0001_shared_company_core',TITAN_CONFIG_CANONICAL_MIGRATION_SHA256:'a'.repeat(64)};
test('failed grant login denies readiness',async()=>{
 let checks=0;
 await assert.rejects(verifyConfigRuntimeReadiness({runtime,env,verifyLogin:async(_,name)=>{checks++;if(name==='grants')throw Error('wrong grant principal');return{login:name}}}));
 assert.equal(checks,2);
});
