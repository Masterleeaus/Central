import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRateLimiter} from '../src/rate-limit.mjs';
import {createJwksRefreshGuard} from '../src/jwks-refresh-guard.mjs';
import {createJsonLogger,safeFields} from '../src/structured-log.mjs';
test('fixed window allows up to the limit then denies with Retry-After',()=>{
 let now=0;const l=createRateLimiter({limit:2,windowMs:10_000,clock:()=>now});
 assert.equal(l.take('a').allowed,true);assert.equal(l.take('a').allowed,true);
 const third=l.take('a');assert.equal(third.allowed,false);assert.equal(third.retryAfterSeconds,10);
 now=10_000;assert.equal(l.take('a').allowed,true);
});
test('keys are limited independently',()=>{
 const l=createRateLimiter({limit:1,windowMs:10_000,clock:()=>0});
 assert.equal(l.take('a').allowed,true);assert.equal(l.take('a').allowed,false);assert.equal(l.take('b').allowed,true);
});
test('key map is bounded under a flood of distinct keys',()=>{
 const l=createRateLimiter({limit:1,windowMs:60_000,maxKeys:5,clock:()=>0});
 for(let i=0;i<1000;i++) l.take('k'+i);
 assert.equal(l.take('k0').allowed,true,'evicted oldest key starts a fresh window');
});
test('invalid limiter configuration is rejected',()=>{
 assert.throws(()=>createRateLimiter({limit:0,windowMs:1000}),TypeError);
 assert.throws(()=>createRateLimiter({limit:1,windowMs:10}),TypeError);
});
test('refresh guard permits one refresh per cooldown and negative-caches misses',()=>{
 let now=1000;const g=createJwksRefreshGuard({cooldownMs:30_000,clock:()=>now});
 assert.equal(g.mayRefresh('x'),true,'never fetched: refresh allowed');
 g.recordFetch();assert.equal(g.mayRefresh('x'),false,'inside cooldown');
 now+=30_000;assert.equal(g.mayRefresh('x'),true);
 g.recordMiss('x');assert.equal(g.mayRefresh('x'),false,'negative cache blocks the same kid');
 assert.equal(g.mayRefresh('y'),true,'a different kid is not negative-cached (cooldown already elapsed)');
 now+=30_000;assert.equal(g.mayRefresh('x'),true,'negative entry expires with the window');
});
test('structured logger drops credential-like fields and reduces errors to class names',()=>{
 const lines=[];const log=createJsonLogger({write:l=>lines.push(l),clock:()=>'T'});
 log('evt',{ok:true,n:2,token:'abc',id_token:'x',subject:'user',sub:'s',authorization:'Bearer q',code:'c',state:'st',error:new TypeError('secret detail')});
 const parsed=JSON.parse(lines[0]);
 assert.deepEqual(parsed,{ts:'T',ok:true,n:2,error:'TypeError',event:'evt'});
 assert.deepEqual(safeFields({obj:{nested:1}}),{});
});
test('structured logger never throws',()=>{
 const log=createJsonLogger({write:()=>{throw Error('disk full')}});
 assert.doesNotThrow(()=>log('evt',{}));
});
