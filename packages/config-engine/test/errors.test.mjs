import test from 'node:test';
import assert from 'node:assert/strict';
import {ConfigError,fail} from '../src/errors.mjs';
test('errors expose machine-readable codes',()=>assert.throws(()=>fail('denied'),e=>e instanceof ConfigError&&e.code==='denied'));
