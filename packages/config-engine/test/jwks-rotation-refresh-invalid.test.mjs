import test from 'node:test';
import assert from 'node:assert/strict';
import {jwksRefreshPolicy} from '../src/jwks-refresh-policy.mjs';
test('refresh intervals must be safe integers with lower and upper bounds',()=>{assert.throws(()=>jwksRefreshPolicy({unknownKidCooldownMs:0}));assert.throws(()=>jwksRefreshPolicy({ttlMs:3600001}));assert.equal(jwksRefreshPolicy().unknownKidCooldownMs,3000)});
