import test from 'node:test';
import assert from 'node:assert/strict';
import {listenCentral} from '../src/service-startup-listener.mjs';
import {EventEmitter} from 'node:events';
test('listener errors reject and remove readiness listeners',async()=>{
 const s=new EventEmitter();s.listen=()=>queueMicrotask(()=>s.emit('error',Error('bind failed')));
 await assert.rejects(listenCentral(s,3102));assert.equal(s.listenerCount('listening'),0);
});
