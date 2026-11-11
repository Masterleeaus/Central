import test from 'node:test';
import assert from 'node:assert/strict';
import {loginForPurpose} from '../src/service-login-policy.mjs';
test('separate login names for four independent trust roles',()=>{
 const roles=['config','grants','writer','authority'].map(loginForPurpose);
 assert.equal(new Set(roles).size,4);
 assert.ok(roles.every(s=>s.endsWith('_login')));
 assert.throws(()=>loginForPurpose('superuser'));
});
