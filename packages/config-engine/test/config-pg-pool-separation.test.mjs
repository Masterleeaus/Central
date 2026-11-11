import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgAuthenticatedConfigHandler} from '../src/pg-config-composition.mjs';
test('handler creation rejects invalid auth settings despite valid pools',()=>{
 assert.throws(()=>createPgAuthenticatedConfigHandler({
  configPool:{connect:async()=>{}},grantPool:{connect:async()=>{}},issuer:'http://insecure.test/',
  audience:'https://api.test/config',jwksUri:'http://insecure.test/jwks',salt:'long-fixed-secret'
 }));
});
