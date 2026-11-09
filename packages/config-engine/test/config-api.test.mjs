import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigApi} from '../src/config-api.mjs';
test('config API refuses missing trusted settings',()=>assert.throws(()=>createConfigApi({pool:{connect(){}},salt:'long-secret-value'})));
