import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFlag} from '../src/evaluate.mjs';
const company='550e8400-e29b-41d4-a716-446655440000';
const definition={key:'onboarding',product:'central',defaultValue:false};
const context={product:'central',environment:'staging',companyId:company,cohorts:['beta']};
const base={product:'central',environment:'staging',value:true,percentage:100,expiresAt:null,revision:1};
test('defaults fail closed',()=>assert.deepEqual(evaluateFlag({definition,context,salt:'some-salt'}),{key:'onboarding',value:false,revision:0,source:'default'}));
test('company targeting wins, expiry falls back',()=>{const overrides=[{...base,target:{cohort:'beta'}},{...base,value:false,revision:2,target:{companyId:company}}];assert.equal(evaluateFlag({definition,context,overrides,salt:'some-salt'}).value,false);assert.equal(evaluateFlag({definition,context,overrides:[{...base,expiresAt:'2020-01-01T00:00:00.000Z',target:{}}],salt:'some-salt'}).value,false);});
