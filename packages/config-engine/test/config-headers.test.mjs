import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG_HEADERS} from '../src/config-headers.mjs';
test('configuration response prohibits caching',()=>{
 assert.match(CONFIG_HEADERS['cache-control'],/no-store/);
 assert.equal(CONFIG_HEADERS['x-content-type-options'],'nosniff');
});
