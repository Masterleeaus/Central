import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthenticatedConfigReader} from '../src/service-client.mjs';
test('authenticated client requires explicit registry and valid issuer',()=>{
 assert.throws(()=>createAuthenticatedConfigReader({issuer:'http://bad.test',audience:'https://api.test/config',store:{readSnapshot(){}},salt:'valid-long-secret'}));
});
