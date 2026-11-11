import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCanonicalDbAtStartup} from '../src/pg-canonical-startup.mjs';
test('schema mismatch rolls back transaction and releases connection',async()=>{
 const statements=[];let releases=0;
 const pool={connect:async()=>({query:async sql=>{statements.push(sql);return{rows:[]}},release(){releases++}})};
 await assert.rejects(verifyCanonicalDbAtStartup(pool));
 assert.equal(statements.at(-1),'ROLLBACK');assert.equal(releases,1);
});
