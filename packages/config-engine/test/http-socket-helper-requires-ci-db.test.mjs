import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCiPoolAdapter} from '../scripts/http-server-harness.mjs';
test('no real CI database means no adapter or accidental production fallback',()=>{
 const before=process.env.CONFIG_TEST_DATABASE_URL;
 try{delete process.env.CONFIG_TEST_DATABASE_URL;assert.throws(()=>buildCiPoolAdapter())}
 finally{if(before!==undefined)process.env.CONFIG_TEST_DATABASE_URL=before}
});
