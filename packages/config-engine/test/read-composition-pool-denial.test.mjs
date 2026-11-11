import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgAuthenticatedConfigHandler} from '../src/pg-config-composition.mjs';
test('signed-JWT configuration read rejects a shared database pool',()=>{
 const pool={connect(){}};
 assert.throws(()=>createPgAuthenticatedConfigHandler({configPool:pool,grantPool:pool,
 issuer:'https://login.example/',jwksUri:'https://login.example/oidc/jwks',
 audience:'https://api.example/config',salt:'example-salt-123456789'}));
});
