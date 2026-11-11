import test from 'node:test';
import assert from 'node:assert/strict';
import {requireM2M} from '../src/require-m2m.mjs';
test('service tokens cannot cross products',()=>{const p={kind:'service',authenticated:true,products:['sorted']};assert.equal(requireM2M(p,'sorted'),p);assert.throws(()=>requireM2M(p,'central'));});
