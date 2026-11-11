import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionConfigRoute} from '../src/config-production-route.mjs';
test('disabled config route never mounts',()=>{
 assert.equal(createProductionConfigRoute({env:{}}),undefined);
 assert.throws(()=>createProductionConfigRoute({env:{TITAN_CONFIG_ENABLED:'true'}}));
});
