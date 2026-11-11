import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSeparateReadPools} from '../src/read-pool-boundary.mjs';
test('one privileged pool for grant and config reads fails closed',()=>{
 const a={connect(){}},b={connect(){}};
 assert.equal(requireSeparateReadPools(a,b),true);
 assert.throws(()=>requireSeparateReadPools(a,a));
 assert.throws(()=>requireSeparateReadPools(null,b));
});
