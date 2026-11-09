import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDefinition} from '../src/definition.mjs';
const fixture={key:'example',owner:'platform',product:'central',type:'boolean',defaultValue:false};
test('normalises verified definition',()=>{const d=validateDefinition(fixture);assert.equal(d.description,'');assert.ok(Object.isFrozen(d));});
test('requires owner and prevents unknown fields',()=>{assert.throws(()=>validateDefinition({...fixture,owner:''}));assert.throws(()=>validateDefinition({...fixture,script:'evil'}));});
