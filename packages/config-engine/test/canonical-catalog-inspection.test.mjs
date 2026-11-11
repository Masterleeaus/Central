import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCanonicalSchema} from '../src/pg-canonical-catalog.mjs';
test('catalog read never queries tenant table data',async()=>{
 const sql=[];
 const result=await inspectCanonicalSchema({query:async s=>{sql.push(s);return{rows:[]}}});
 assert.deepEqual(result,{relations:[],foreignKeys:[]});
 assert.equal(sql.length,2);assert.ok(sql.every(s=>s.includes('pg_catalog.')));
});
