import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionConfigRoute} from '../../../apps/control-api/src/config-production-route.mjs';
test('disabled config route remains absent with injected pools',()=>{
 const r={configPool:{connect(){}},grantPool:{connect(){}}};
 assert.equal(createProductionConfigRoute({env:{},runtime:r}),undefined);
});
