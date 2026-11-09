import test from 'node:test';import assert from 'node:assert/strict';
import {call,valid} from './service-decision-harness.mjs';
test('wrong content type rejected',async()=>assert.equal((await call({headers:{'content-type':'text/plain'}})).status,400));
test('oversized request body rejected',async()=>assert.equal((await call({body:JSON.stringify({...valid,pad:'a'.repeat(3000)})})).status,400));
test('bad JSON rejected',async()=>assert.equal((await call({body:'{malformed'})).status,400));
test('unwanted search params rejected',async()=>assert.equal((await call({url:'/v1/integrations/academy/decision?subject=forged'})).status,400));
test('extra customer role rejected',async()=>assert.equal((await call({body:{...valid,role:'owner'}})).status,400));