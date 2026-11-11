import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgAuthenticatedConfigHandler} from '../src/pg-config-composition.mjs';
test('composition requires two explicitly provided pools',()=>{
 assert.throws(()=>createPgAuthenticatedConfigHandler({configPool:{connect(){}},issuer:'https://issuer.test/'}));
 assert.throws(()=>createPgAuthenticatedConfigHandler({grantPool:{connect(){}},issuer:'https://issuer.test/'}));
});
