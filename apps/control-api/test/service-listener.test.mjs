import test from 'node:test';
import assert from 'node:assert/strict';
import {listenCentral} from '../src/service-startup-listener.mjs';
import {EventEmitter} from 'node:events';
test('successful listener removes transient error handler',async()=>{
 const s=new EventEmitter();s.listen=()=>queueMicrotask(()=>s.emit('listening'));
 await listenCentral(s,3102);assert.equal(s.listenerCount('error'),0);
});
