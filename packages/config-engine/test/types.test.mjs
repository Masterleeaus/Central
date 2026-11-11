import test from 'node:test';
import assert from 'node:assert/strict';
import {validateValue} from '../src/types.mjs';
test('type constraints reject coercion',()=>{assert.equal(validateValue('boolean',false),false);assert.throws(()=>validateValue('boolean','false'));assert.throws(()=>validateValue('integer',1.2));});
test('allowlist rejects drift and duplicates',()=>{assert.equal(validateValue('string','on',['on','off']),'on');assert.throws(()=>validateValue('string','other',['on','off']));assert.throws(()=>validateValue('string','on',['on','on']));});
