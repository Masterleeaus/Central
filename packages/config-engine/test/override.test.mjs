import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOverride} from '../src/override.mjs';
const def={product:'central',type:'boolean'};
const base={product:'central',environment:'staging',value:true,revision:1};
test('overrides validate revision, expiry and scope',()=>{assert.equal(validateOverride(def,base).percentage,100);assert.throws(()=>validateOverride(def,{...base,revision:0}));assert.throws(()=>validateOverride(def,{...base,expiresAt:'yesterday'}));});
test('rejects product and arbitrary fields',()=>{assert.throws(()=>validateOverride(def,{...base,product:'sorted'}));assert.throws(()=>validateOverride(def,{...base,code:'execute'}));});
