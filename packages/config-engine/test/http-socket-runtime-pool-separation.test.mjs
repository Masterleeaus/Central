import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSeparateReadPools} from '../src/read-pool-boundary.mjs';
test('real HTTP server cannot share configuration and grant pools',()=>{
 const pool={connect(){}};assert.throws(()=>requireSeparateReadPools(pool,pool));
});
