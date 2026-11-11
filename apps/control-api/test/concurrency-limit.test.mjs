import test from 'node:test';
import assert from 'node:assert/strict';
import {createConcurrencyLimiter} from '../src/concurrency-limit.mjs';

test('per-key concurrency refuses extra requests before work begins',()=>{
 const limiter=createConcurrencyLimiter({perKey:2,globalLimit:10});
 const first=limiter.acquire('socket-a'),second=limiter.acquire('socket-a');
 assert.equal(typeof first,'function');
 assert.equal(typeof second,'function');
 assert.equal(limiter.acquire('socket-a'),null);
 assert.equal(limiter.snapshot().active,2);
 first();
 assert.equal(typeof limiter.acquire('socket-a'),'function');
 second();
});
test('global cap cannot be bypassed by many different clients',()=>{
 const limiter=createConcurrencyLimiter({perKey:2,globalLimit:3});
 const leases=['a','b','c'].map(key=>limiter.acquire(key));
 assert.equal(limiter.acquire('attacker-d'),null);
 assert.deepEqual(limiter.snapshot(),{active:3,keys:3});
 leases.forEach(release=>release());
 assert.deepEqual(limiter.snapshot(),{active:0,keys:0});
});
test('active keys cannot be evicted when key cardinality is exhausted',()=>{
 const limiter=createConcurrencyLimiter({perKey:2,globalLimit:20,maxKeys:2});
 const a=limiter.acquire('a'),b=limiter.acquire('b');
 assert.equal(limiter.acquire('c'),null);
 assert.equal(limiter.acquire('a') instanceof Function,true);
 assert.equal(limiter.acquire('b') instanceof Function,true);
 a();b();
});
test('release is idempotent; unknown key cannot consume capacity',()=>{
 const limiter=createConcurrencyLimiter({perKey:1,globalLimit:1});
 const a=limiter.acquire('a');
 a();a();
 assert.deepEqual(limiter.snapshot(),{active:0,keys:0});
 for(const value of ['',null,{},'x'.repeat(257)])assert.equal(limiter.acquire(value),null);
 const b=limiter.acquire('b');assert.equal(typeof b,'function');b();
});
test('invalid concurrency capacities fail closed at configuration',()=>{
 for(const value of [0,-1,1.5,Number.MAX_SAFE_INTEGER,'12']){
  assert.throws(()=>createConcurrencyLimiter({perKey:value}),TypeError);
  assert.throws(()=>createConcurrencyLimiter({globalLimit:value}),TypeError);
  assert.throws(()=>createConcurrencyLimiter({maxKeys:value}),TypeError);
 }
});
