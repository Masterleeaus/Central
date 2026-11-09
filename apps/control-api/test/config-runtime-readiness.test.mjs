import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyConfigRuntimeReadiness} from '../src/config-runtime-readiness.mjs';
const a={connect(){}},b={connect(){}},runtime={configPool:a,grantPool:b},env={TITAN_CONFIG_MIGRATION_APPROVED:'true',TITAN_CONFIG_CANONICAL_MIGRATION_ID:'0001_shared_company_core',TITAN_CONFIG_CANONICAL_MIGRATION_SHA256:'a'.repeat(64)};
test('role, schema and receipt gates execute in order',async()=>{
 const order=[];
 const r=await verifyConfigRuntimeReadiness({runtime,env,verifyLogin:async(_,name)=>{order.push(name);return{login:name}},verifySchema:async()=>{order.push('schema')},verifyReceipt:async()=>{order.push('receipt');return{migrationId:'0001_shared_company_core'}}});
 assert.deepEqual(order,['config','grants','schema','receipt']);assert.equal(r.ready,true);
});
