import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceRegistry} from '../src/service-registry.mjs';
const companyId='550e8400-e29b-41d4-a716-446655440000';
test('authoritative lookup supplies tenant not token',async()=>{
 let args;
 const resolve=createServiceRegistry({lookup:async x=>{args=x;return{active:true,product:'central',environment:'staging',companyId,cohorts:['beta']}}});
 const principal={authenticated:true,kind:'service',clientId:'trusted',companyId:'not-trusted'};
 assert.equal((await resolve(principal,'central','staging')).companyId,companyId);
 assert.deepEqual(args,{clientId:'trusted',application:'central',environment:'staging'});
 await assert.rejects(resolve(principal,'sorted','staging'));
});
