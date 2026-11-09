import test from 'node:test';import assert from 'node:assert/strict';
import {call,issuer,subject,requestId,decision} from './service-decision-harness.mjs';
test('authenticated service receives decision envelope with only trusted IDs/revisions',async()=>{
 const r=await call();assert.equal(r.status,200);assert.deepEqual(r.body,{issuer,subject,requestId,decision});
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('missing service auth never calls decision engine',async()=>{
 let calls=0;const r=await call({auth:'',decide:async()=>{calls++;return decision}});
 assert.equal(r.status,401);assert.equal(calls,0);
});
test('restricted endpoint cannot be GET or wrong path',async()=>{
 assert.equal((await call({method:'GET'})).status,405);
 assert.equal((await call({url:'/v1/access/check'})).status,404);
});
test('denied identity does not disclose local account data',async()=>{
 const r=await call({decide:async()=>null});assert.equal(r.status,403);
 assert.equal(JSON.stringify(r.body).includes('skilled-user'),false);
});
test('read error fails closed without leaking details',async()=>{
 const r=await call({decide:async()=>{throw Error('DB credential leaked')}});assert.equal(r.status,503);
 assert.equal(JSON.stringify(r.body).includes('DB credential'),false);
});