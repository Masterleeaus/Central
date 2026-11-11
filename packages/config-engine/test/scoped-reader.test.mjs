import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopedSnapshotReader} from '../src/scoped-reader.mjs';
test('passes normalised company and de-duplicated cohorts',async()=>{
 let input;const companyId='550e8400-e29b-41d4-a716-446655440000';
 const reader=createScopedSnapshotReader({store:{readSnapshot:async x=>(input=x,{definition:null,overrides:[]})}});
 await reader.readSnapshot({key:'flag',product:'central',environment:'staging',companyId,cohorts:['beta','beta']});
 assert.deepEqual(input.cohorts,['beta']);
});
