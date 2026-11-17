import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startOidcStatePruning} from '../src/oidc-state-prune-schedule.mjs';

/** Fake timer: records the callback and interval; the test fires ticks by hand. */
function fakeSchedule() {
  const timers=[];
  return {
    timers,
    setInterval(fn,ms){const t={fn,ms,unref(){t.unrefCalled=true;},cleared:false};timers.push(t);return t;},
    clearInterval(t){t.cleared=true;}
  };
}
const pool={connect:async()=>({})};

test('schedules one unref-ed timer at the given interval and does not prune before the first tick',()=>{
  const schedule=fakeSchedule();const calls=[];
  startOidcStatePruning({pool,intervalMs:120_000,schedule,prune:async()=>{calls.push(1);return 0;}});
  assert.equal(schedule.timers.length,1);
  assert.equal(schedule.timers[0].ms,120_000);
  assert.equal(schedule.timers[0].unrefCalled,true);
  assert.equal(calls.length,0);
});

test('each tick prunes with the pool and clock, and reports the removed count',async()=>{
  const schedule=fakeSchedule();const clock=()=>42;const seen=[];const reported=[];
  startOidcStatePruning({pool,clock,schedule,prune:async(p,c)=>{seen.push([p,c]);return 3;},onPruned:n=>reported.push(n)});
  await schedule.timers[0].fn();
  assert.equal(seen.length,1);
  assert.equal(seen[0][0],pool);
  assert.equal(seen[0][1],clock);
  assert.deepEqual(reported,[3]);
});

test('a tick that starts while a run is still going does not start a second run',async()=>{
  const schedule=fakeSchedule();let release;let calls=0;
  startOidcStatePruning({pool,schedule,prune:()=>{calls++;if(calls>1)return Promise.resolve(0);return new Promise(r=>{release=r;});}});
  const first=schedule.timers[0].fn();
  await schedule.timers[0].fn();
  assert.equal(calls,1);
  release(0);
  await first;
  await schedule.timers[0].fn();
  assert.equal(calls,2);
});

test('a failed run is reported and the next tick still runs',async()=>{
  const schedule=fakeSchedule();const errors=[];let n=0;
  startOidcStatePruning({pool,schedule,onError:e=>errors.push(e.message),prune:async()=>{n++;if(n===1)throw new Error('db down');return 0;}});
  await schedule.timers[0].fn();
  await schedule.timers[0].fn();
  assert.deepEqual(errors,['db down']);
  assert.equal(n,2);
});

test('a throwing error reporter does not stop the schedule',async()=>{
  const schedule=fakeSchedule();let n=0;
  startOidcStatePruning({pool,schedule,onError:()=>{throw new Error('log broken');},prune:async()=>{n++;throw new Error('x');}});
  await assert.doesNotReject(()=>schedule.timers[0].fn());
  await schedule.timers[0].fn();
  assert.equal(n,2);
});

test('stop clears the timer once and turns later ticks into no-ops',async()=>{
  const schedule=fakeSchedule();let n=0;
  const handle=startOidcStatePruning({pool,schedule,prune:async()=>{n++;return 0;}});
  handle.stop();
  handle.stop();
  assert.equal(schedule.timers[0].cleared,true);
  await schedule.timers[0].fn();
  assert.equal(n,0);
});

test('rejects invalid configuration without starting a timer',()=>{
  const schedule=fakeSchedule();
  assert.throws(()=>startOidcStatePruning({pool:{},schedule}),TypeError);
  assert.throws(()=>startOidcStatePruning({pool,intervalMs:1000,schedule}),TypeError);
  assert.throws(()=>startOidcStatePruning({pool,intervalMs:4_000_000,schedule}),TypeError);
  assert.throws(()=>startOidcStatePruning({pool,intervalMs:1.5,schedule}),TypeError);
  assert.equal(schedule.timers.length,0);
});
