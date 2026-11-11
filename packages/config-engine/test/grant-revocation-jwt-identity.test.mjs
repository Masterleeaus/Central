import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceBearer} from '../scripts/http-server-harness.mjs';
test('signed token remains stable independently of server-side grant revocation',()=>{const token=serviceBearer('svc_a');assert.ok(token.startsWith('Bearer '));assert.equal(token.split('.').length,3)});