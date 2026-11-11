import test from 'node:test';import assert from 'node:assert/strict';
import {call,issuer,subject,requestId,decision} from './service-decision-harness.mjs';
test('authenticated service receives decision envelope with only trusted IDs/revisions',async()=>{
 const r=await call();assert.equal(r.status,200);
 const {expiresAt,...rest}=r.body.decision;
 assert.deepEqual({...r.body,decision:rest},{issuer,subject,requestId,decision});
 assert.match(expiresAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('decision expiresAt is exactly 300 seconds after issue',async()=>{
 const issuedAt=Date.parse('2026-11-11T10:00:00.000Z');
 const r=await call({clock:()=>issuedAt});assert.equal(r.status,200);
 assert.equal(r.body.decision.expiresAt,'2026-11-11T10:05:00.000Z');
 assert.equal(Date.parse(r.body.decision.expiresAt)-issuedAt,300_000);
 assert.equal(r.body.decision.allowed,true);
});
test('decision expiresAt is not set on denied or failed decisions',async()=>{
 const denied=await call({decide:async()=>null});assert.equal(denied.status,403);
 assert.equal(denied.body.decision,undefined);
 const failed=await call({decide:async()=>{throw Error('down')}});assert.equal(failed.status,503);
 assert.equal(failed.body.decision,undefined);
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
test('expiry is derived from the injected issue clock, not request receipt time',async()=>{
 const issuedAt=Date.parse('2030-01-01T00:00:00.000Z');
 const r=await call({clock:()=>issuedAt});
 assert.equal(r.status,200);
 assert.equal(r.body.decision.expiresAt,'2030-01-01T00:05:00.000Z');
});
