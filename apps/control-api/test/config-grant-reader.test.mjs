import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigGrantReader} from '../src/config-grant-reader.mjs';
test('trusted lookup provides company grants',async()=>{
 let params;const companyId='550e8400-e29b-41d4-a716-446655440000';
 const read=createConfigGrantReader({fetchGrant:async x=>{params=x;return{active:true,product:'central',environment:'stage',companyId,cohorts:[]}}});
 assert.equal((await read({clientId:'svc',application:'central',environment:'stage'})).companyId,companyId);
 assert.deepEqual(params,{clientId:'svc',application:'central',environment:'stage'});
 await assert.rejects(read({clientId:'invalid token',application:'central',environment:'stage'}));
});
