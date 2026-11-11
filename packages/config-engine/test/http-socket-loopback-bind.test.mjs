import test from 'node:test';
import assert from 'node:assert/strict';
import {listenCentral} from '../../../apps/control-api/src/service-startup-listener.mjs';
import {EventEmitter} from 'node:events';
test('central listener is bound only to 127.0.0.1',async()=>{
 const s=new EventEmitter();let ip;
 s.listen=(port,address)=>{ip=address;queueMicrotask(()=>s.emit('listening'))};
 await listenCentral(s,3102);assert.equal(ip,'127.0.0.1');
});
