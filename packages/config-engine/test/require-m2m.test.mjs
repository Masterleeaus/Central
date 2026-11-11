import test from 'node:test';
import assert from 'node:assert/strict';
import {requireM2M} from '../src/require-m2m.mjs';
test('rejects user identity for M2M',()=>{
 const principal={authenticated:true,kind:'service',products:['central']};
 assert.equal(requireM2M(principal,'central'),principal);
 assert.throws(()=>requireM2M({...principal,kind:'user'},'central'));
 assert.throws(()=>requireM2M(principal,'sorted'));
});
