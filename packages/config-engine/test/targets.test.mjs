import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTarget,matchesTarget} from '../src/targets.mjs';
const id='550e8400-e29b-41d4-a716-446655440000';
test('company targeting cannot cross tenant',()=>{const t=validateTarget({companyId:id});assert.equal(matchesTarget(t,{companyId:id}),true);assert.equal(matchesTarget(t,{companyId:'other'}),false);});
test('cohort selection requires trusted cohort list',()=>{const t=validateTarget({cohort:'beta'});assert.equal(matchesTarget(t,{cohorts:['beta']}),true);assert.equal(matchesTarget(t,{cohorts:['other']}),false);assert.throws(()=>validateTarget({companyId:id,cohort:'beta'}));});
