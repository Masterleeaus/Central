import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigRoute} from '../src/config-route.mjs';
test('legacy adapter defaults to off',()=>assert.equal(createConfigRoute({env:{}}),undefined));
